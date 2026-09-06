import { Router } from "express";
import { config } from "../config.js";

export const raizRouter = Router();

/**
 * Indice do servico.
 *
 * A raiz existe porque a URL publica do Render e a primeira coisa que uma
 * pessoa abre no navegador - sem isso, o primeiro contato com a API e um 404.
 * Nao consome a API do Gemini.
 */
raizRouter.get("/", (_req, res) => {
  res.json({
    servico: "pipeline-ia-dupla",
    descricao:
      "Recebe um texto cru, reescreve como prompt estruturado (IA 1) e executa (IA 2).",
    endpoints: [
      {
        metodo: "POST",
        caminho: "/processar",
        alias: "/api/process-text",
        corpo: { texto: "string, ate " + config.maxInputChars + " caracteres" },
        retorna: ["prompt_otimizado", "resposta_final", "meta"],
      },
      { metodo: "GET", caminho: "/health", descricao: "Liveness probe." },
      { metodo: "GET", caminho: "/", descricao: "Este indice." },
    ],
    exemplo:
      "curl -X POST " +
      "https://pipeline-ia-dupla.onrender.com/processar " +
      "-H 'Content-Type: application/json' " +
      "-d '{\"texto\":\"quero um site de vendas rapido\"}'",
    modelos: {
      otimizacao: config.optimizer.model,
      execucao: config.executor.model,
    },
  });
});
