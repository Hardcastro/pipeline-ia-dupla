import { Router } from "express";
import { config } from "../config.js";
import { ValidationError } from "../errors.js";
import { exigirSenha } from "../middleware/auth.js";
import { executeTask, optimizePrompt, runPipeline } from "../services/pipeline.js";

export const processarRouter = Router();

/** Valida e normaliza o corpo da requisicao. */
function parseBody(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ValidationError('Corpo invalido. Envie um JSON com o campo "texto".');
  }

  const { texto } = body;

  if (typeof texto !== "string") {
    throw new ValidationError('O campo "texto" e obrigatorio e deve ser uma string.');
  }

  const trimmed = texto.trim();
  if (trimmed === "") {
    throw new ValidationError('O campo "texto" nao pode estar vazio.');
  }

  if (trimmed.length > config.maxInputChars) {
    throw new ValidationError(
      `O campo "texto" excede o limite de ${config.maxInputChars} caracteres.`,
      { recebido: trimmed.length, limite: config.maxInputChars },
    );
  }

  return trimmed;
}

/**
 * Valida o prompt de /executar/stream.
 *
 * Limite proprio e mais folgado que o de `texto`: aqui ja e um prompt tecnico
 * expandido pela IA 1, entao naturalmente maior que o pedido cru do usuario.
 */
function parsePrompt(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ValidationError('Corpo invalido. Envie um JSON com o campo "prompt".');
  }

  const { prompt } = body;
  if (typeof prompt !== "string") {
    throw new ValidationError('O campo "prompt" e obrigatorio e deve ser uma string.');
  }

  const limpo = prompt.trim();
  if (limpo === "") {
    throw new ValidationError('O campo "prompt" nao pode estar vazio.');
  }

  const limite = config.maxInputChars * 4;
  if (limpo.length > limite) {
    throw new ValidationError(
      `O campo "prompt" excede o limite de ${limite} caracteres.`,
      { recebido: limpo.length, limite },
    );
  }

  return limpo;
}

async function handler(req, res, next) {
  try {
    const texto = parseBody(req.body);
    const resultado = await runPipeline(texto);
    res.json(resultado);
  } catch (error) {
    next(error);
  }
}

/**
 * Mesma coisa, em Server-Sent Events.
 *
 * O pipeline leva de 10s a alguns minutos, e o servidor sabe em qual etapa
 * esta e quando um 503 disparou nova tentativa. Sem streaming essa informacao
 * so chegaria no final, junto com o resultado - e o prompt da IA 1, pronto em
 * poucos segundos, ficaria escondido ate la.
 */
async function handlerStream(req, res, next) {
  let texto;
  try {
    texto = parseBody(req.body);
  } catch (error) {
    return next(error); // ainda da para responder JSON com status
  }

  const enviar = abrirStream(req, res);

  try {
    const resultado = await runPipeline(texto, enviar);
    enviar({ tipo: "fim", ...resultado });
  } catch (error) {
    encerrarComErro(req, res, enviar, error);
  } finally {
    if (!res.writableEnded) res.end();
  }
}

/** Abre um stream SSE e devolve a funcao que escreve nele. */
function abrirStream(req, res) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // impede buffering em proxy
  res.flushHeaders?.();

  // O ouvinte vai em `res`, nao em `req`: o IncomingMessage emite "close"
  // assim que o corpo termina de ser lido, o que mataria o stream no ato.
  let desconectou = false;
  res.on("close", () => { desconectou = true; });

  return (evento) => {
    if (desconectou || res.writableEnded || res.destroyed) return;
    res.write(`data: ${JSON.stringify(evento)}\n\n`);
  };
}

/** Erro depois dos cabecalhos enviados vira evento, nao status HTTP. */
function encerrarComErro(req, res, enviar, error) {
  console.error(`[erro] ${req.method} ${req.originalUrl}`, error);
  enviar({
    tipo: "erro",
    erro: {
      codigo: error.code ?? "internal_error",
      mensagem: error.message ?? "Erro interno inesperado.",
      ...(error.stage ? { etapa: error.stage } : {}),
    },
  });
}

/**
 * So a Camada de Otimizacao (IA 1).
 *
 * Existe para o fluxo de revisao: quem quiser conferir ou ajustar o prompt
 * antes de gastar a IA 2 pede so a reescrita, edita, e chama /executar depois.
 */
async function handlerOtimizar(req, res, next) {
  try {
    const texto = parseBody(req.body);
    const otimizado = await optimizePrompt(texto);
    res.json({
      prompt_otimizado: otimizado.prompt,
      meta: { otimizacao: { model: otimizado.model, usage: otimizado.usage } },
    });
  } catch (error) {
    next(error);
  }
}

/** So a Camada de Execucao (IA 2), em stream, a partir de um prompt pronto. */
async function handlerExecutarStream(req, res, next) {
  let prompt;
  try {
    prompt = parsePrompt(req.body);
  } catch (error) {
    return next(error);
  }

  const enviar = abrirStream(req, res);
  const inicio = Date.now();

  try {
    enviar({ tipo: "etapa", etapa: "execucao", estado: "inicio" });
    const executado = await executeTask(prompt, enviar);
    enviar({
      tipo: "fim",
      prompt_otimizado: prompt,
      resposta_final: executado.text,
      meta: {
        execucao: {
          model: executado.model,
          usage: executado.usage,
          latency_ms: Date.now() - inicio,
        },
        latency_ms_total: Date.now() - inicio,
      },
    });
  } catch (error) {
    encerrarComErro(req, res, enviar, error);
  } finally {
    if (!res.writableEnded) res.end();
  }
}

processarRouter.post("/processar", exigirSenha, handler);
// Alias equivalente, para quem ja integrou com esse caminho.
processarRouter.post("/api/process-text", exigirSenha, handler);
processarRouter.post("/processar/stream", exigirSenha, handlerStream);
processarRouter.post("/otimizar", exigirSenha, handlerOtimizar);
processarRouter.post("/executar/stream", exigirSenha, handlerExecutarStream);
