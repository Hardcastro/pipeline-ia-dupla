import { Router } from "express";
import { config } from "../config.js";

export const raizRouter = Router();

/**
 * Indice da API em /api.
 *
 * A raiz (/) agora serve a interface web; este endpoint mantem o descritor
 * legivel por maquina, para quem integra em vez de clicar. Nao consome a API
 * do Gemini.
 */
raizRouter.get("/api", (_req, res) => {
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
      { metodo: "GET", caminho: "/api", descricao: "Este indice." },
      { metodo: "GET", caminho: "/", descricao: "Interface web." },
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
