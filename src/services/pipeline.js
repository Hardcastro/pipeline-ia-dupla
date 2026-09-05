import { ApiError, FinishReason } from "@google/genai";
import { gemini } from "../gemini/client.js";
import { config } from "../config.js";
import { PipelineError } from "../errors.js";
import {
  OPTIMIZER_OUTPUT_SCHEMA,
  OPTIMIZER_SYSTEM_PROMPT,
  buildOptimizerUserMessage,
} from "../prompts/optimizer.js";
import { EXECUTOR_SYSTEM_PROMPT } from "../prompts/executor.js";

/** Motivos de parada que significam "o modelo bloqueou o conteudo". */
const BLOCKED_FINISH_REASONS = new Set([
  FinishReason.SAFETY,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
  FinishReason.RECITATION,
]);

/**
 * Valida a resposta antes de ler o texto.
 *
 * O Gemini bloqueia em dois pontos distintos, ambos com HTTP 200:
 *  - `promptFeedback.blockReason`: a entrada foi barrada, nem gerou candidato;
 *  - `candidates[0].finishReason`: a geracao comecou e foi interrompida.
 */
function assertUsableResponse(response, stage) {
  const blockReason = response.promptFeedback?.blockReason;
  if (blockReason) {
    throw new PipelineError("O prompt foi bloqueado pelos filtros do Gemini.", {
      stage,
      status: 422,
      code: "prompt_blocked",
      details: {
        motivo: blockReason,
        mensagem: response.promptFeedback?.blockReasonMessage ?? null,
      },
    });
  }

  const candidate = response.candidates?.[0];
  if (!candidate) {
    throw new PipelineError("O Gemini nao retornou nenhum candidato.", {
      stage,
      code: "no_candidates",
    });
  }

  const { finishReason } = candidate;

  if (BLOCKED_FINISH_REASONS.has(finishReason)) {
    throw new PipelineError("A geracao foi interrompida pelos filtros do Gemini.", {
      stage,
      status: 422,
      code: "content_blocked",
      details: { motivo: finishReason },
    });
  }

  if (finishReason === FinishReason.MAX_TOKENS) {
    throw new PipelineError(
      "A resposta foi truncada por atingir o limite de tokens de saida. " +
        "Tokens de raciocinio consomem esse mesmo limite - aumente " +
        "*_MAX_OUTPUT_TOKENS ou reduza *_THINKING.",
      { stage, status: 502, code: "max_tokens_truncated" },
    );
  }

  if (finishReason && finishReason !== FinishReason.STOP) {
    throw new PipelineError(`Geracao interrompida (${finishReason}).`, {
      stage,
      status: 502,
      code: "unexpected_finish_reason",
      details: { motivo: finishReason },
    });
  }
}

/** Campos de uso relevantes para log/auditoria de custo. */
function summarizeUsage(response) {
  const usage = response.usageMetadata ?? {};
  return {
    prompt_tokens: usage.promptTokenCount ?? 0,
    candidates_tokens: usage.candidatesTokenCount ?? 0,
    thoughts_tokens: usage.thoughtsTokenCount ?? 0,
    cached_tokens: usage.cachedContentTokenCount ?? 0,
    total_tokens: usage.totalTokenCount ?? 0,
  };
}

/**
 * Erros que valem uma nova tentativa: sobrecarga temporaria do modelo e falhas
 * de servidor. 429 fica de fora de proposito - na pratica ele significa cota
 * esgotada, e insistir so queima mais quota.
 */
const STATUS_RETENTAVEIS = new Set([500, 502, 503, 504]);

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Repete a chamada com backoff exponencial e jitter.
 *
 * O SDK do Gemini nao tem retry proprio, e "This model is currently
 * experiencing high demand" (503) e comum o bastante para derrubar o pipeline
 * em uso normal.
 */
async function comRetry(fn, stage) {
  let ultimoErro;

  for (let tentativa = 0; tentativa <= config.retry.attempts; tentativa += 1) {
    try {
      return await fn();
    } catch (error) {
      const retentavel = error instanceof ApiError && STATUS_RETENTAVEIS.has(error.status);
      if (!retentavel || tentativa === config.retry.attempts) throw error;

      ultimoErro = error;
      // backoff exponencial + jitter, para nao sincronizar varias requisicoes
      const espera = config.retry.baseDelayMs * 2 ** tentativa * (0.5 + Math.random());
      console.warn(
        `[retry] ${stage}: ${error.status} na tentativa ${tentativa + 1}/` +
          `${config.retry.attempts + 1}, nova tentativa em ${Math.round(espera)}ms`,
      );
      await esperar(espera);
    }
  }

  throw ultimoErro;
}

/** Aborta a chamada se o modelo demorar alem do teto configurado. */
function timeoutSignal() {
  return AbortSignal.timeout(config.requestTimeoutMs);
}

/**
 * Camada de Otimizacao (IA 1).
 * Recebe o texto bruto do usuario e devolve um prompt estruturado.
 * A saida e forcada por JSON Schema, entao nao ha preambulo para limpar.
 *
 * @param {string} userInput texto bruto do usuario
 * @returns {Promise<{ prompt: string, model: string, usage: object }>}
 */
export async function optimizePrompt(userInput) {
  const stage = "otimizacao";

  const response = await comRetry(() => gemini.models.generateContent({
    model: config.optimizer.model,
    contents: buildOptimizerUserMessage(userInput),
    config: {
      systemInstruction: OPTIMIZER_SYSTEM_PROMPT,
      maxOutputTokens: config.optimizer.maxOutputTokens,
      thinkingConfig: config.optimizer.thinking,
      // responseJsonSchema exige responseMimeType e e incompativel com responseSchema.
      responseMimeType: "application/json",
      responseJsonSchema: OPTIMIZER_OUTPUT_SCHEMA,
      abortSignal: timeoutSignal(),
    },
  }), stage);

  assertUsableResponse(response, stage);

  const raw = (response.text ?? "").trim();
  let prompt;
  try {
    prompt = JSON.parse(raw).prompt_otimizado;
  } catch {
    // Se o schema falhar por qualquer motivo, o texto cru ainda e utilizavel.
    prompt = raw;
  }

  if (typeof prompt !== "string" || prompt.trim() === "") {
    throw new PipelineError("A IA de otimizacao devolveu um prompt vazio.", {
      stage,
      code: "empty_optimized_prompt",
    });
  }

  return {
    prompt: prompt.trim(),
    model: config.optimizer.model,
    usage: summarizeUsage(response),
  };
}

/**
 * Camada de Execucao (IA 2).
 * Recebe o prompt ja otimizado e produz a resposta final.
 *
 * @param {string} optimizedPrompt saida da IA 1
 * @returns {Promise<{ text: string, model: string, usage: object }>}
 */
export async function executeTask(optimizedPrompt) {
  const stage = "execucao";

  const response = await comRetry(() => gemini.models.generateContent({
    model: config.executor.model,
    contents: optimizedPrompt,
    config: {
      systemInstruction: EXECUTOR_SYSTEM_PROMPT,
      maxOutputTokens: config.executor.maxOutputTokens,
      thinkingConfig: config.executor.thinking,
      abortSignal: timeoutSignal(),
    },
  }), stage);

  assertUsableResponse(response, stage);

  const text = (response.text ?? "").trim();
  if (text === "") {
    throw new PipelineError("A IA de execucao devolveu uma resposta vazia.", {
      stage,
      code: "empty_final_answer",
    });
  }

  return { text, model: config.executor.model, usage: summarizeUsage(response) };
}

/**
 * Pipeline completo: texto bruto -> prompt otimizado -> resposta final.
 *
 * @param {string} texto
 * @returns {Promise<{ prompt_otimizado: string, resposta_final: string, meta: object }>}
 */
export async function runPipeline(texto) {
  const startedAt = Date.now();

  const optimized = await optimizePrompt(texto);
  const optimizedAt = Date.now();

  const executed = await executeTask(optimized.prompt);
  const finishedAt = Date.now();

  return {
    prompt_otimizado: optimized.prompt,
    resposta_final: executed.text,
    meta: {
      otimizacao: {
        model: optimized.model,
        thinking: config.optimizer.thinking,
        usage: optimized.usage,
        latency_ms: optimizedAt - startedAt,
      },
      execucao: {
        model: executed.model,
        thinking: config.executor.thinking,
        usage: executed.usage,
        latency_ms: finishedAt - optimizedAt,
      },
      latency_ms_total: finishedAt - startedAt,
    },
  };
}
