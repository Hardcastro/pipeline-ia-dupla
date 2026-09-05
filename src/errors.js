/** Erro de aplicacao com status HTTP e codigo estavel para o cliente. */
export class AppError extends Error {
  constructor(message, { status = 500, code = "internal_error", details } = {}) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message, details) {
    super(message, { status: 400, code: "validation_error", details });
    this.name = "ValidationError";
  }
}

/** Falha originada em uma das camadas do pipeline (IA 1 ou IA 2). */
export class PipelineError extends AppError {
  constructor(message, { stage, status = 502, code = "pipeline_error", details } = {}) {
    super(message, { status, code, details });
    this.name = "PipelineError";
    this.stage = stage;
  }
}
