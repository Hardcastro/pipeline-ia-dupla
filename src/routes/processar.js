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

processarRouter.post("/processar", exigirSenha, handler);
// Alias equivalente, para quem ja integrou com esse caminho.
processarRouter.post("/api/process-text", exigirSenha, handler);
