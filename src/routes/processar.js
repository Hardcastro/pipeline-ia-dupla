import { Router } from "express";
import { config } from "../config.js";
import { ValidationError } from "../errors.js";
import { exigirSenha } from "../middleware/auth.js";
import { runPipeline } from "../services/pipeline.js";

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

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // impede buffering em proxy
  res.flushHeaders?.();

  // Cliente desistiu: nao adianta seguir escrevendo em socket fechado.
  //
  // O ouvinte vai em `res`, nao em `req`: o IncomingMessage emite "close"
  // assim que o corpo termina de ser lido, o que aconteceria logo apos o POST
  // e mataria o stream antes do primeiro evento util.
  let desconectou = false;
  res.on("close", () => { desconectou = true; });

  const enviar = (evento) => {
    if (desconectou || res.writableEnded || res.destroyed) return;
    res.write(`data: ${JSON.stringify(evento)}\n\n`);
  };

  try {
    const resultado = await runPipeline(texto, enviar);
    enviar({ tipo: "fim", ...resultado });
  } catch (error) {
    // Cabecalhos ja foram enviados, entao o errorHandler nao serve aqui:
    // o erro vira um evento do proprio stream.
    console.error(`[erro] ${req.method} ${req.originalUrl}`, error);
    enviar({
      tipo: "erro",
      erro: {
        codigo: error.code ?? "internal_error",
        mensagem: error.message ?? "Erro interno inesperado.",
        ...(error.stage ? { etapa: error.stage } : {}),
      },
    });
  } finally {
    if (!res.writableEnded) res.end();
  }
}

processarRouter.post("/processar", exigirSenha, handler);
// Alias equivalente, para quem ja integrou com esse caminho.
processarRouter.post("/api/process-text", exigirSenha, handler);
processarRouter.post("/processar/stream", exigirSenha, handlerStream);
