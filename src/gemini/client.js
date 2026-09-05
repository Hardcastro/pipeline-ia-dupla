import { GoogleGenAI } from "@google/genai";

/**
 * Cliente unico e reaproveitado entre requisicoes (mantem keep-alive HTTP).
 * `GEMINI_API_KEY` e a variavel documentada aqui; o SDK tambem reconhece
 * `GOOGLE_API_KEY` sozinho, entao aceitamos as duas.
 */
export const gemini = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
});
