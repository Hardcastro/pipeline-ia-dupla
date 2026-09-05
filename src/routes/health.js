import { Router } from "express";
import { config } from "../config.js";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    uptime_s: Math.round(process.uptime()),
    modelos: {
      otimizacao: config.optimizer.model,
      execucao: config.executor.model,
    },
  });
});
