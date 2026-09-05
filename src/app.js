import express from "express";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { healthRouter } from "./routes/health.js";
import { processarRouter } from "./routes/processar.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.use(healthRouter);
  app.use(processarRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
