# Pipeline de IA dupla (Node.js + Express + Google Gemini)

API que recebe um texto cru de usuario leigo e o processa em duas camadas:

```
texto bruto  ->  IA 1 (Engenheira de Prompt)  ->  prompt otimizado  ->  IA 2 (Executora)  ->  resposta final
```

O retorno traz as duas pontas, para que o prompt intermediario fique disponivel
para auditoria e log.

## Estrutura

```
src/
  index.js                  bootstrap do servidor + shutdown limpo
  app.js                    montagem do Express
  config.js                 leitura e validacao das variaveis de ambiente
  errors.js                 AppError / ValidationError / PipelineError
  gemini/client.js          cliente unico do SDK @google/genai
  prompts/optimizer.js      system instruction da IA 1 + schema de saida
  prompts/executor.js       system instruction da IA 2
  services/pipeline.js      optimizePrompt() / executeTask() / runPipeline()
  routes/processar.js       POST /processar (+ alias /api/process-text)
  routes/health.js          GET /health
  middleware/errorHandler.js  traducao de erros do SDK para HTTP
```

## Como rodar

Requer Node 20 ou superior (exigencia do `@google/genai`).

```bash
npm install
cp .env.example .env   # e preencha GEMINI_API_KEY
npm start
```

`npm run dev` sobe com `--watch` (reinicio automatico a cada alteracao).

Chave de API: <https://aistudio.google.com/apikey>

## Endpoints

### `POST /processar`

Requisicao:

```json
{ "texto": "quero um site de vendas rapido" }
```

Resposta `200`:

```json
{
  "prompt_otimizado": "Contexto: ...\nObjetivo: ...\nRequisitos: ...\nFormato de Saida: ...",
  "resposta_final": "...",
  "meta": {
    "otimizacao": {
      "model": "gemini-3-flash-preview",
      "thinking": { "thinkingLevel": "LOW" },
      "usage": { "prompt_tokens": 0, "candidates_tokens": 0, "thoughts_tokens": 0, "cached_tokens": 0, "total_tokens": 0 },
      "latency_ms": 0
    },
    "execucao": {
      "model": "gemini-3-pro-preview",
      "thinking": { "thinkingLevel": "HIGH" },
      "usage": { "prompt_tokens": 0, "candidates_tokens": 0, "thoughts_tokens": 0, "cached_tokens": 0, "total_tokens": 0 },
      "latency_ms": 0
    },
    "latency_ms_total": 0
  }
}
```

`meta` e informativo (custo e latencia por camada); os dois campos pedidos —
`prompt_otimizado` e `resposta_final` — sao sempre strings.

`POST /api/process-text` e um alias do mesmo handler.

### `GET /health`

Liveness probe. Nao consome a API do Gemini.

## Teste rapido (cURL)

```bash
curl -s -X POST http://localhost:3000/processar -H 'Content-Type: application/json' -d '{"texto":"quero um site de vendas rapido"}'
```

No Postman: `POST http://localhost:3000/processar`, Body -> raw -> JSON, com o
mesmo corpo acima.

## Erros

Todo erro sai no formato:

```json
{ "erro": { "codigo": "...", "mensagem": "...", "etapa": "otimizacao|execucao", "detalhes": {} } }
```

| Codigo | HTTP | Quando |
|---|---|---|
| `validation_error` | 400 | `texto` ausente, vazio ou acima de `MAX_INPUT_CHARS` |
| `invalid_json` | 400 | corpo nao e JSON valido |
| `rota_nao_encontrada` | 404 | rota inexistente |
| `prompt_blocked` | 422 | entrada barrada pelos filtros (`promptFeedback.blockReason`) |
| `content_blocked` | 422 | geracao interrompida por SAFETY / BLOCKLIST / PROHIBITED_CONTENT / SPII / RECITATION |
| `upstream_rate_limited` | 429 | 429 da API (limite de requisicoes ou cota) |
| `upstream_auth_error` | 500 | chave invalida ou sem permissao |
| `upstream_model_not_found` | 500 | modelo inexistente ou indisponivel para a chave |
| `max_tokens_truncated` | 502 | resposta cortada no limite de tokens de saida |
| `upstream_bad_request` | 502 | requisicao rejeitada pela API |
| `unexpected_finish_reason` | 502 | parada por RECITATION/LANGUAGE/OTHER etc. |
| `upstream_unavailable` | 503 | 5xx da API, apos esgotar as tentativas |
| `upstream_timeout` | 504 | estourou `REQUEST_TIMEOUT_MS` |

## Modelos e raciocinio

Padrao verificado nesta chave em 2026-09-05: `gemini-3.1-flash-lite` na IA 1
(reescrever e a tarefa leve das duas) e `gemini-3.5-flash` na IA 2. Configuraveis
por `OPTIMIZER_MODEL` e `EXECUTOR_MODEL`.

### Disponibilidade medida (nao presuma, teste)

O catalogo do Gemini gira rapido, e o que a documentacao do SDK sugere nem sempre
existe. Sondagem feita com esta chave:

| Modelo | Resultado |
|---|---|
| `gemini-3.1-flash-lite` | OK, ~0,5s |
| `gemini-2.5-flash` | OK, ~0,6s |
| `gemini-3-flash-preview` | OK isolado, 503 sob carga |
| `gemini-3.5-flash` | OK, ~14s |
| `gemini-3.8-flash` | intermitente (503 recorrente) |
| `gemini-3.6-flash` / `gemini-3.7-flash` | 503 UNAVAILABLE |
| `gemini-3-pro-preview` | aposentado (404) |
| `gemini-3.1-pro-preview` / `gemini-2.5-pro` | **429 RESOURCE_EXHAUSTED** — sem cota de tier pro |

> **Os modelos pro estao fora de alcance nesta chave.** Para usar `gemini-3.1-pro-preview`
> na IA 2, e preciso habilitar billing / tier pago no Google AI Studio. Ate la,
> as duas camadas rodam em flash.

Para redescobrir o que esta disponivel, liste os modelos da chave:

```bash
node -e "import('dotenv/config').then(async()=>{const{GoogleGenAI}=await import('@google/genai');const ai=new GoogleGenAI({apiKey:process.env.GEMINI_API_KEY});for await(const m of await ai.models.list())console.log(m.name)})"
```

### Raciocinio muda entre geracoes

| Geracao | Campo da API | Valor em `*_THINKING` |
|---|---|---|
| Gemini 3 | `thinkingConfig.thinkingLevel` | `minimal`, `low`, `medium`, `high` |
| Gemini 2.5 | `thinkingConfig.thinkingBudget` | inteiro de tokens (`0` desliga, `-1` automatico) |

`config.js` cobre as duas formas na mesma variavel, entao trocar de familia e so
trocar duas variaveis de ambiente:

```bash
EXECUTOR_MODEL=gemini-2.5-flash
EXECUTOR_THINKING=4096
```

> **Armadilha:** tokens de raciocinio contam dentro de `maxOutputTokens`. Um teto
> baixo com raciocinio alto retorna `finishReason: MAX_TOKENS` com texto vazio —
> por isso os padroes de `*_MAX_OUTPUT_TOKENS` sao folgados, e o erro
> `max_tokens_truncated` explica as duas saidas possiveis. Confira
> `meta.*.usage.thoughts_tokens` para ver quanto o raciocinio consumiu.

## Decisoes de implementacao

- **Saida da IA 1 forcada por schema:** em vez de confiar na instrucao "retorne
  exclusivamente o prompt" e depois limpar saudacoes com regex, a chamada usa
  `responseMimeType: "application/json"` + `responseJsonSchema` com um unico
  campo. O modelo nao consegue emitir preambulo. Ha fallback para o texto cru
  caso o parse falhe.
- **Blindagem contra injecao:** o texto do usuario chega envelopado em
  `<texto_do_usuario>` e a system instruction declara que aquele conteudo e dado,
  nao instrucao — inclusive quando contem frases como "ignore as instrucoes acima".
- **Bloqueio verificado nos dois pontos:** o Gemini barra conteudo tanto na
  entrada (`promptFeedback.blockReason`) quanto durante a geracao
  (`candidates[0].finishReason`), ambos com HTTP 200. O pipeline checa os dois
  antes de ler o texto, para nao devolver resposta vazia silenciosa.
- **Retry com backoff:** a API do Gemini responde 503 "high demand" com
  frequencia em uso normal, e o SDK nao tem retry proprio. Ambas as camadas
  repetem em 500/502/503/504 com backoff exponencial + jitter
  (`RETRY_ATTEMPTS`, `RETRY_BASE_DELAY_MS`). **429 fica de fora de proposito:**
  na pratica significa cota esgotada, e insistir so queima mais cota.
  Cada tentativa carrega o proprio `REQUEST_TIMEOUT_MS`, entao o pior caso de
  tempo total e aproximadamente `attempts x timeout` — reduza `RETRY_ATTEMPTS`
  se precisar de um teto de latencia mais apertado.
- **Timeout explicito:** cada chamada leva um `abortSignal` de
  `REQUEST_TIMEOUT_MS`, para que uma geracao travada nao segure a conexao HTTP
  indefinidamente.

## Producao

No ar em <https://pipeline-ia-dupla.onrender.com> (Render, plano free, regiao Oregon,
runtime Docker, branch `main` com auto-deploy).

Latencia medida em 2026-09-05, mesma entrada:

| Ambiente | IA 1 | IA 2 | Total |
|---|---|---|---|
| Local | ~2,0s | ~11s | ~13s |
| Render free | ~2,0s | 25-63s | 28-82s |

A IA 1 se comporta igual nos dois. A variancia toda esta na IA 2
(`gemini-3.5-flash`), e **nao e retry** — os logs do Render registram uma unica
linha `[retry]`, na IA 1, que se recuperou na segunda tentativa. As hipoteses
restantes sao a variancia do proprio modelo (ja era o mais lento da sondagem) e
o teto de 0.1 CPU do plano free.

Se a latencia incomodar, na ordem de custo crescente: baixar `EXECUTOR_THINKING`
para `medium`, trocar `EXECUTOR_MODEL` por um flash mais rapido, ou subir de
plano. Os dois primeiros sao variaveis de ambiente no Render — nao exigem novo
deploy de codigo.

> O plano free hiberna apos inatividade: a primeira chamada depois disso soma
> ~50s de cold start. `GET /health` acorda o servico sem consumir a API do Gemini.

## Deploy

O `Dockerfile` incluido serve para qualquer plataforma de container. No Render,
um Web Service Node tambem sobe direto do repositorio (`npm install` +
`npm start`); em ambos os casos, injete `GEMINI_API_KEY` como variavel de
ambiente — nunca comite o `.env`.

```bash
docker build -t pipeline-ia-dupla .
docker run --rm -p 3000:3000 -e GEMINI_API_KEY=AIza... pipeline-ia-dupla
```
