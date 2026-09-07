import "dotenv/config";
import { ThinkingLevel } from "@google/genai";

const THINKING_LEVELS = ["minimal", "low", "medium", "high"];

function readInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} invalido: "${raw}". Informe um inteiro positivo.`);
  }
  return parsed;
}

/**
 * O controle de raciocinio mudou entre geracoes do Gemini:
 *  - Gemini 3 usa `thinkingLevel` ("minimal" | "low" | "medium" | "high");
 *  - Gemini 2.5 usa `thinkingBudget`, em tokens (0 desliga, -1 e automatico).
 *
 * Aceitamos as duas formas na mesma variavel de ambiente e montamos o
 * `thinkingConfig` correto, para que trocar de modelo nao exija mudar codigo.
 */
function readThinking(name, fallback) {
  const raw = (process.env[name] || fallback).trim();

  if (/^-?\d+$/.test(raw)) {
    const budget = Number.parseInt(raw, 10);
    if (budget < -1) {
      throw new Error(`${name} invalido: "${raw}". Orcamento minimo e -1 (automatico).`);
    }
    return { thinkingBudget: budget };
  }

  const level = raw.toLowerCase();
  if (!THINKING_LEVELS.includes(level)) {
    throw new Error(
      `${name} invalido: "${raw}". Use um nivel (${THINKING_LEVELS.join(", ")}) ` +
        `para modelos Gemini 3, ou um numero de tokens para Gemini 2.5.`,
    );
  }
  return { thinkingLevel: ThinkingLevel[level.toUpperCase()] };
}

export const config = {
  port: readInt("PORT", 3000),
  maxInputChars: readInt("MAX_INPUT_CHARS", 8000),
  requestTimeoutMs: readInt("REQUEST_TIMEOUT_MS", 300_000),

  retry: {
    // Sobrecarga temporaria do modelo (503) e comum na API do Gemini.
    attempts: readInt("RETRY_ATTEMPTS", 3),
    baseDelayMs: readInt("RETRY_BASE_DELAY_MS", 1_000),
  },

  optimizer: {
    model: process.env.OPTIMIZER_MODEL || "gemini-3.1-flash-lite",
    thinking: readThinking("OPTIMIZER_THINKING", "low"),
    maxOutputTokens: readInt("OPTIMIZER_MAX_OUTPUT_TOKENS", 8192),
  },

  executor: {
    model: process.env.EXECUTOR_MODEL || "gemini-3.1-flash-lite",
    thinking: readThinking("EXECUTOR_THINKING", "high"),
    maxOutputTokens: readInt("EXECUTOR_MAX_OUTPUT_TOKENS", 32_768),
  },
};

/** Falha cedo, na subida do processo, em vez de estourar so na primeira requisicao. */
export function assertCredentials() {
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY nao definida. Copie .env.example para .env e preencha a " +
        "chave obtida em https://aistudio.google.com/apikey",
    );
  }
}
