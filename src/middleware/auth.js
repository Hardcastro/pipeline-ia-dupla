import crypto from "node:crypto";
import { config } from "../config.js";
import { AppError } from "../errors.js";

/**
 * Comparacao em tempo constante.
 *
 * `===` em string vaza o tamanho do prefixo correto pelo tempo de execucao, o
 * que permite descobrir a senha caractere a caractere. O hash iguala os
 * comprimentos antes de comparar, porque `timingSafeEqual` lanca excecao com
 * buffers de tamanhos diferentes - e o proprio lancamento seria um sinal.
 */
function iguaisEmTempoConstante(a, b) {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Exige a senha compartilhada nos endpoints que consomem a API do Gemini.
 *
 * Aceita `x-senha: <valor>` ou `Authorization: Bearer <valor>`. Quando
 * ACESSO_SENHA nao esta definida a protecao fica desligada - o servidor avisa
 * no boot, porque uma URL publica sem senha gasta a cota de quem hospeda.
 */
export function exigirSenha(req, _res, next) {
  if (!config.acessoSenha) return next();

  const doHeader = req.get("x-senha") || "";
  const doBearer = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const fornecida = doHeader || doBearer;

  if (fornecida && iguaisEmTempoConstante(fornecida, config.acessoSenha)) {
    return next();
  }

  next(
    new AppError(
      fornecida ? "Senha incorreta." : "Esta rota exige senha.",
      { status: 401, code: "nao_autorizado" },
    ),
  );
}
