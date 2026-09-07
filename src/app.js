import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { healthRouter } from "./routes/health.js";
import { processarRouter } from "./routes/processar.js";
import { raizRouter } from "./routes/raiz.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  // A plataforma termina o TLS antes do processo; sem isso req.protocol
  // reportaria "http" mesmo em requisicoes https.
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "1mb" }));

  // Interface web em /. Caminho derivado do modulo, nao do cwd: no container o
  // processo pode subir de outro diretorio.
  const raizDoProjeto = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  app.use(express.static(path.join(raizDoProjeto, "public")));

  app.use(raizRouter);
  app.use(healthRouter);
  app.use(processarRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
