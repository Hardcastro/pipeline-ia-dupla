import { ApiError } from "@google/genai";
import { AppError } from "../errors.js";

/**
 * O `ApiError` do SDK so expoe `status` e `message` - mas a `message` e o corpo
 * JSON do erro da API. Extraimos dali o `reason` estruturado (ex.:
 * "API_KEY_INVALID") e a mensagem legivel, em vez de aplicar regex em prosa ou
 * devolver o blob cru ao cliente.
 */
function parseApiErrorBody(error) {
  try {
    const body = JSON.parse(error.message)?.error;
    if (!body) return { reason: null, message: error.message };
    return {
      reason: body.details?.find((d) => d.reason)?.reason ?? body.status ?? null,
      message: body.message ?? error.message,
    };
  } catch {
    return { reason: null, message: error.message };
  }
}

/** Traduz erros do SDK do Gemini em respostas HTTP do nosso dominio. */
function mapGeminiError(error) {
  // AbortSignal.timeout() dispara TimeoutError; um abort manual, AbortError.
  if (error?.name === "TimeoutError" || error?.name === "AbortError") {
    return {
      status: 504,
      code: "upstream_timeout",
      message: "A chamada ao Gemini excedeu o tempo limite (REQUEST_TIMEOUT_MS).",
    };
  }

  if (!(error instanceof ApiError)) return null;

  const { reason, message } = parseApiErrorBody(error);

  // Chave invalida chega como 400 API_KEY_INVALID, nao como 401 - checar o
  // reason antes do status, senao a falha de config mais comum vira "bad request".
  if (reason === "API_KEY_INVALID" || error.status === 401 || error.status === 403) {
    // Credencial e problema nosso, nao do cliente desta API.
    return {
      status: 500,
      code: "upstream_auth_error",
      message: `Falha de autenticacao com a API do Gemini (${reason ?? error.status}). Verifique a GEMINI_API_KEY.`,
    };
  }

  switch (error.status) {
    case 400:
      return {
        status: 502,
        code: "upstream_bad_request",
        message: `Requisicao rejeitada pela API do Gemini: ${message}`,
      };
    case 404:
      return {
        status: 500,
        code: "upstream_model_not_found",
        message: `Modelo nao encontrado ou indisponivel para esta chave: ${message}`,
      };
    case 429:
      return {
        status: 429,
        code: "upstream_rate_limited",
        message: "Limite de requisicoes ou de cota atingido. Tente novamente em instantes.",
      };
    default:
      if (error.status >= 500) {
        return {
          status: 503,
          code: "upstream_unavailable",
          message: "A API do Gemini esta indisponivel no momento.",
        };
      }
      return {
        status: 502,
        code: "upstream_error",
        message: `Erro na API do Gemini (${error.status}): ${message}`,
      };
  }
}

// eslint-disable-next-line no-unused-vars -- Express identifica o handler pela aridade 4
export function errorHandler(error, req, res, _next) {
  let payload;

  if (error instanceof AppError) {
    payload = {
      status: error.status,
      code: error.code,
      message: error.message,
      details: error.details,
      stage: error.stage,
    };
  } else if (error?.type === "entity.parse.failed") {
    // body-parser: JSON malformado
    payload = {
      status: 400,
      code: "invalid_json",
      message: "O corpo da requisicao nao e um JSON valido.",
    };
  } else {
    payload = mapGeminiError(error) ?? {
      status: 500,
      code: "internal_error",
      message: "Erro interno inesperado.",
    };
  }

  if (payload.status >= 500) {
    console.error(`[erro] ${req.method} ${req.originalUrl}`, error);
  } else {
    console.warn(`[aviso] ${req.method} ${req.originalUrl} -> ${payload.code}`);
  }

  res.status(payload.status).json({
    erro: {
      codigo: payload.code,
      mensagem: payload.message,
      ...(payload.stage ? { etapa: payload.stage } : {}),
      ...(payload.details ? { detalhes: payload.details } : {}),
    },
  });
}

export function notFoundHandler(req, res) {
  res.status(404).json({
    erro: {
      codigo: "rota_nao_encontrada",
      mensagem: `Rota ${req.method} ${req.originalUrl} nao existe.`,
    },
  });
}
