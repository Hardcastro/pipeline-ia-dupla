import { createApp } from "./app.js";
import { assertCredentials, config } from "./config.js";

assertCredentials();

const app = createApp();

/** "low" (nivel, Gemini 3) ou "1024 tokens" (orcamento, Gemini 2.5). */
function describeThinking({ thinkingLevel, thinkingBudget }) {
  return thinkingLevel ?? `${thinkingBudget} tokens`;
}

const server = app.listen(config.port, () => {
  console.log(`Pipeline de IA dupla ouvindo em http://localhost:${config.port}`);
  console.log(`  POST /processar          (alias: POST /api/process-text)`);
  console.log(`  GET  /health`);
  console.log(
    `  IA 1: ${config.optimizer.model} (thinking ${describeThinking(config.optimizer.thinking)}) -> ` +
      `IA 2: ${config.executor.model} (thinking ${describeThinking(config.executor.thinking)})`,
  );
});

// Encerramento limpo - importante em container (Render, Docker, K8s).
for (const sinal of ["SIGTERM", "SIGINT"]) {
  process.on(sinal, () => {
    console.log(`\n${sinal} recebido, encerrando...`);
    server.close(() => process.exit(0));
  });
}
