# Модуль ИИ (Polza.ai)

Конфигурация (TASK-101), доступ продавца (TASK-102), HTTP-клиент `PolzaClient` (TASK-103) и `AiService` —
единственная точка любого ИИ-функционала (TASK-104). Вверху — справочные таблицы, команды и примеры
вызова; правила с причинами — в «Доводах и истории решений».

## Переменные окружения

| Переменная                  | Обязательность                      | Смысл                                                                              |
| --------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------- |
| `POLZA_AI_TOKEN`            | необязательна                       | ключ Polza.ai. Пусто или нет — **ИИ выключен**, бот стартует и работает как обычно |
| `POLZA_AI_MODEL`            | обязательна, **если задан токен**   | идентификатор модели. Умолчания нет: выбор модели — выбор цены                     |
| `POLZA_AI_MODELS`           | необязательна                       | модель по назначению: `purpose=модель` через запятую поверх `POLZA_AI_MODEL`       |
| `POLZA_AI_BASE_URL`         | по умолчанию `https://polza.ai/api` | база API: ровно `<схема>://<хост>[:порт]/api`                                      |
| `POLZA_AI_PROXY_URL`        | необязательна                       | HTTP-прокси только для Polza, `http://хост:порт`. Пусто — напрямую                 |
| `AI_USER_DAILY_LIMIT_RUB`   | по умолчанию `50`                   | дневной лимит расхода на продавца, ₽ за московские сутки. `0` — без лимита         |
| `POLZA_AI_BALANCE_WARN_RUB` | по умолчанию `200`                  | порог самопроверки баланса, ₽: ниже — warn админам. `0` — без warn, ≤ 0 ₽ — авария |

- `process.env` и `config.get` вне `src/config/app-config.service.ts` не читать — геттеры
  `polzaAiToken`, `polzaAiModel`, `polzaAiModelFor(purpose)`, `polzaAiBaseUrl` (без хвостового слеша).
- Назначения (`purpose`) — закрытый список `TAiPurpose`/`AI_PURPOSES` в `ai-purpose.ts`; константа нового
  назначения типизируется `TAiPurpose`, иначе её не задать в `POLZA_AI_MODELS`.

## Клиент `PolzaClient`

`polza.client.ts`, ошибки — `polza.errors.ts`, повторы — `polza-retry.ts`.

| Метод              | Запрос                      | Что отдаёт                                                                                                |
| ------------------ | --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `chatCompletion()` | `POST /v1/chat/completions` | `content`, `usage` (токены, `cachedTokens`, `reasoningTokens`, `costRub`), `model`, `provider`, `traceId` |
| `getBalance()`     | `GET /v2/balance`           | `amount`, `available`, `reservedAmount`, `spentAmount` — числа (у Polza строки с 8 знаками)               |
| `listModels()`     | `GET /v1/models`            | `{id, name?, type?, contextLength, pricing, structuredOutputs}[]` — цена ₽ за 1M или `null`               |

- Клиент **не знает про фичу `ai`** и про продавцов. Без ключа любой метод бросает `PolzaDisabledError`
  до HTTP, модуль при этом поднимается.

### Ошибки и повторы

| Код                 | Класс                         | Повтор  |
| ------------------- | ----------------------------- | ------- |
| 401                 | `PolzaAuthError`              | нет     |
| 402                 | `PolzaInsufficientFundsError` | нет     |
| 403                 | `PolzaModerationError`        | нет     |
| 429                 | `PolzaRateLimitError`         | да      |
| 408/502/503         | `PolzaServerError`            | да      |
| 400/404/409/413/500 | `PolzaApiError`               | нет     |
| нет ответа          | `PolzaNetworkError`           | **нет** |
| нет ключа           | `PolzaDisabledError`          | —       |

Пауза, число попыток и почему так — в «Доводах», абзац о `PolzaClient`.

## Диагностика: `scripts/diagnose-polza.ts`

Используется, чтобы выбрать `POLZA_AI_MODEL` по цене и проверить, что Polza доступна (TASK-107).

```bash
npx ts-node scripts/diagnose-polza.ts                   # баланс, текущая модель с ценой — бесплатно
npx ts-node scripts/diagnose-polza.ts --models=flash    # chat-модели с ценами ₽/1M, фильтр по id/имени
npx ts-node scripts/diagnose-polza.ts --chat            # ПЛАТНО: короткий запрос — цена, токены, trace_id
npx ts-node scripts/diagnose-polza.ts --json            # ПЛАТНО: проба response_format json_schema
npx ts-node scripts/diagnose-polza.ts --tools           # ПЛАТНО: проба tool-calling, два раунда
npx ts-node scripts/diagnose-polza.ts --chat --model=z-ai/glm-5.3-flash   # кандидат до правки .env
```

Доступность с прод-хоста (скрипта в образе нет) проверяется бесплатно, из контейнера:

```bash
node -e "fetch((process.env.POLZA_AI_BASE_URL||'https://polza.ai/api')+'/v2/balance',{headers:{Authorization:'Bearer '+process.env.POLZA_AI_TOKEN}}).then(r=>r.text()).then(t=>console.log(t))"
```

Ответ с `available` означает, что Polza доступна. Этот `fetch` идёт **напрямую**, мимо
`POLZA_AI_PROXY_URL`. Если задан прокси, проверка через него с хоста:
`curl -x "$POLZA_AI_PROXY_URL" -sS -m 15 -o /dev/null -w '%{http_code}\n' https://polza.ai/api/v2/balance`
(`401` без ключа — прокси и Polza отвечают).

## `AiService`

`ai.service.ts`, отказы — `ai.errors.ts`, учёт — `AiUsage` (`src/database/schemas/ai-usage.schema.ts`).

```ts
const result = await ai.complete(
  { telegramUserId, aiAllowed, purpose: 'feedback-reply' },
  { messages },
);
```

Вызывающие сегодня: `feedback-reply` — черновик ответа на отзыв (`yandex/feedback/feedback-draft.service.ts`,
TASK-167), `period-review`, `ai-analyst` (с инструментами), `check`. `purpose` — свободная строка, по ней
админка делит расходы.

Барьеры — по порядку, все **до HTTP**:

| Условие                                   | Что бросает              | Строка `AiUsage` |
| ----------------------------------------- | ------------------------ | ---------------- |
| нет `telegramUserId` или `purpose`        | `Error` (ошибка кода)    | нет              |
| `aiAllowed === false`                     | `AiFeatureDisabledError` | нет              |
| `polzaAiEnabled === false`                | `AiUnavailableError`     | нет              |
| потрачено за сутки ≥ лимита               | `AiDailyLimitError`      | нет              |
| сумму за сутки не прочитать (Mongo лежит) | `AiUnavailableError`     | нет              |

### `AiService.completeWithTools` — диалог с инструментами (TASK-147)

```ts
const answer = await ai.completeWithTools(ctx, { messages }, aiTools.toolbox(ctx.telegramUserId));
// answer.content — текст; answer.toolResults — все вызовы с результатами; answer.rounds — запросов к Polza
```

- Протокол в клиенте: роли `assistant` (с `toolCalls`) и `tool` (с `toolCallId`) уходят в snake_case
  (`toWireMessage`), в ответе — `toolCalls` (аргументы сырой строкой) и `finishReason`.

### `AiService.balance()` — только для самопроверки

Правила — в «Доводах», абзац о `AiService.balance()`; проба баланса — `src/modules/health/README.md`.

### Страница «ИИ» админ-панели (`AiAdminModule`)

Правила — в «Доводах», абзац о странице «ИИ». Секция «Качество ответов» (TASK-170): `GET /api/ai/usage` отдаёт
`quality.{purposes, days}` — счётчики `AiTurnService.quality` (один aggregate по `AiTurn`, без `eval`) и доли
`qualityShares` (`ai-usage.domain.ts`); клик по строке — журнал запросов с фильтром purpose (и МСК-днём).
Источник счётчиков — README ai-analyst, «Качество ответов».

## Доводы и история решений

> Перенесено из корневого `CLAUDE.md` (2026-10-18), чтобы он не грузил в каждую сессию то, что нужно
> только при работе в этом модуле. Сюда же слиты правила, которые раньше повторялись в верхней части
> README; вверху остались только таблицы, команды и примеры вызова.

**Polza.ai (M15, TASK-101).** The owner chose Polza.ai — an OpenAI-compatible aggregator paid in
roubles and reachable from the Moscow host without a VPN. AI is an add-on, not a condition of the
bot working, so the three variables are shaped around "a deploy without a key must start":

- `POLZA_AI_TOKEN` is optional and **empty means unset** (`.empty('')`, the `REDIS_PASSWORD`
  precedent) — the key sits empty in `.env.example` and compose. `.empty('')` also matters for the
  `when` below: without it an empty token would count as present and demand a model.
- `POLZA_AI_MODEL` is required **only when the token is set** (Joi `when`, the
  `TELEGRAM_WEBHOOK_URL` pattern). No default on purpose: choosing a model is choosing a price per
  request, and that is not ours to pick silently. A key without a model is an unfinished setup and
  fails startup by name, rather than surfacing as the first refusal at runtime.
- `POLZA_AI_BASE_URL` must end in **exactly `/api`** (`requireApiPath`) — the mirror image of the
  `TELEGRAM_API_URL` rule: the client appends the method path, so a missing segment
  (`https://polza.ai`) or an extra one (`/api/v1`) does not crash anything, it turns every request
  into a silent 404. Поэтому такие значения отвергаются на старте.
- **`POLZA_AI_PROXY_URL` (optional, `http://host:port`, empty = direct)** exists because the network
  hosting Polza stopped accepting TCP from the NL prod IP on 14-10-2026 (`curl` timed out at
  connect, `mtr` died inside the hoster's network, while a KZ node got `401` in 1 s). Not a
  reverse mirror via `POLZA_AI_BASE_URL` like `TELEGRAM_API_URL`: that would need a domain and a
  certificate on the relay, otherwise the Bearer key crosses the internet in clear text. A forward
  proxy needs neither — `https-proxy-agent` tunnels TLS to polza.ai through `CONNECT`, the relay
  never sees the key. axios's own `proxy` option is avoided (it sends a plain request instead of
  `CONNECT` for https targets) and set to `false`, so a stray `HTTPS_PROXY` in the environment cannot
  route Polza — or anything else — implicitly. Only `PolzaClient` uses it; Yandex and Telegram do not.
  Прокси обязан пускать только IP сервера бота (`Allow` в tinyproxy), иначе это открытый прокси.
- `AppConfigService.polzaAiEnabled` is the single "is AI on" decision; nothing checks the token
  itself. The variables are summarised in the table at the top of this README.
- **Per seller, AI is the feature `ai` (TASK-102) — a second condition, not a second token check.**
  `defaultEnabled: false`: there is one key and the owner pays for every request, so AI is opened
  one seller at a time from the panel, the `warehouses`/`fby` rollout. Like `promotion` and
  `hosting_reminder` it has **no `MENU` key** and `featureGate` does not know it — no update maps
  to "AI", it lives inside other screens. The last barrier is `AiService` (below), and it gets
  the flag as a **ready boolean** from the caller (admin already resolved via
  `allFeaturesEnabled`) — the `StockUploadPolicyService` argument: `src/modules/ai/` must not
  import the bot's feature registry (`features.domain.ts`) nor `UserAccess`. In CRM parity it sits in
  `FEATURES_WITHOUT_SECTION`.

**`PolzaClient` (TASK-103) — axios, not the OpenAI SDK, and its retry policy is Polza's, not OpenAI's.**
Two GETs and one POST without streaming do not justify a dependency that brings its own retries.
Таймаут клиента 620 с — потолок запроса у Polza 600 с.

- **Polza does not bill failed requests, but has no idempotency key.** So only what its docs say to
  retry is retried: 429, 408, 502, 503 (`Retry-After` — секунды или HTTP-дата — when sent, else
  1/2/4 s, 4 attempts). 402 is never retried, since a retry adds no money. 500 is not retried: the
  docs say "contact the provider".
- **A network failure or timeout is not retried either**, unlike Yandex. The request may have reached the
  model and been paid for, and a second answer costs money. The 620 s timeout would also hold the worker
  another ten minutes.
- `Retry-After` over 60 s is not waited out (the error goes up at once). A worker asleep for minutes over
  one AI answer blocks its queue.
- `withPolzaRetry` runs **parallel** to Yandex's `withRetry` and shares only `backoffDelay`/`TSleep`.
  Generalising `withRetry` would touch every report for the sake of a second client.
- **The error body is nested**: `{error: {code, message, trace_id}, trace_id}`. The flat shape in the task
  text was wrong (checked against the docs and live 401s). Live 200s match the doc example, except that
  `provider` is absent for some models (`google/gemini-2.5-flash-lite`), so it maps to an empty string. Both
  are read. `metadata.raw`, the upstream provider's raw answer, is dropped rather than stored; the error
  does not keep the whole body either.
- **Nothing masks a Bearer token**: `maskSecrets` and `maskOutgoing` do not catch it. The key lives only
  in the `Authorization: Bearer` header of the axios instance, and the client logs status, method, path,
  `code`, `trace_id` and the message — never `config.headers` or the request body. A test checks that the
  key appears nowhere: logs, the error, `ErrorReporter`'s journal row. `ErrorReporter` forces
  `source: 'polza'` by class, the `yandex` pattern.
- **`AiModule` exports only `AiService`.** `PolzaClient` is a factory provider inside it, and a test
  proves a neighbour module cannot inject it.

**`AiService` (TASK-104) is the only door to Polza.** `complete({telegramUserId, aiAllowed, purpose}, request)`.
Everything that can refuse runs **before** HTTP, in this order: missing `telegramUserId`/`purpose` → plain
`Error` (a programmer's bug, the `dryRun` argument); `!aiAllowed` → `AiFeatureDisabledError`;
`!polzaAiEnabled` → `AiUnavailableError`; the daily limit → `AiDailyLimitError`. The barrier sits in the
service rather than in handlers for the `featureGate` reason: a new handler cannot forget it, because there is
no other door. The service does not read `UserAccess` — `aiAllowed` arrives as a ready boolean.

- **Each request, ok or failed, is one `AiUsage` row** (TTL 180 days; `{telegramUserId, createdAt}` serves the
  daily sum): `status: 'ok'` or `'error'` with `httpStatus`, `errorCode`, `traceId`; tokens, `costRub`, the
  requested and the answering model, provider, duration. The key is shared and the owner pays, so spend must
  be visible per request — and «why does AI not work for this seller» has no answer without the failed rows.
  **No prompt or answer text is stored**: it is the seller's correspondence and product data, and a second
  copy of it is the `maskSecrets` argument. A test pins that neither the row nor the schema can carry it.
- **`costRub` is `usage.cost_rub` as Polza sent it**, never recomputed from tokens: the price list is Polza's,
  and our own arithmetic would drift from their invoice silently. A failed request writes `costRub: 0` — Polza
  does not bill failures.
- The write is `void`-ed and `AiUsageService.record` never throws (the `ActionLogService.record` policy): the
  answer is already received and paid for, a dead Mongo must not turn it into an error.
- **The daily limit `AI_USER_DAILY_LIMIT_RUB`** (default **50 ₽**, `0` = none — owner's decision
  `ai_daily_limit_default`) is checked per Moscow day (`moscowDayStart`) as a sum of `costRub` **before** the
  request. A default with no limit would mean one runaway loop drains the shared balance. It is a check, not
  an atomic reservation, so parallel requests of one seller may overshoot by one request — kopecks.
  **If the sum cannot be read, the request is refused** (`ai_limit_unknown_refuse`): spending someone else's
  money blind is the "unknown means forbidden" rule of stock writes. `limit = 0` skips the read entirely.
- **`AiError` subclasses do not extend `PolzaApiError`**: `ErrorReporter` sets `source: 'polza'` by class, and a
  closed feature or an exhausted limit is not a Polza failure — not a failure at all. Callers show
  `userMessage` and do not report them.
- **Polza failures are reported by the service itself** (`context: ai:<purpose>`, `direction: 'out'`) and
  rethrown unchanged — callers must **not** report a `PolzaApiError` again. The `ErrorReporter` alerts by
  default and has no 4xx filter, so the decision is explicit in `shouldAlertPolzaError`: everything alerts
  (402 no money, 401 key revoked, 400 our malformed request, 429 after retries, 5xx, network) **except 403**,
  moderation rejecting the seller's content — client behaviour. `AlertThrottle` dampens the stream. No retries
  in the service: the client deliberately does not retry network errors or 500.
- **`AiService.completeWithTools` (TASK-147) is the dialog with tools, not a third door.** Each round is a plain
  `complete` — same barriers, its own limit check and its own `AiUsage` row — so a closed `ai` or an exhausted
  limit refuses on round one, before HTTP and before any tool runs. The toolbox (`IAiToolbox`,
  `ai-tools.types.ts`) is built for one seller and must match `ctx.telegramUserId`, or it throws before a
  request: billing and data scope cannot drift. At most `MAX_TOOL_ROUNDS` (4) tool rounds, then one forced
  `toolChoice: 'none'` — a model calling tools in a circle would otherwise spend the owner's money with no
  answer. Within a round at most `MAX_TOOL_CALLS_PER_ROUND` (8) calls are executed, the rest get an error.
  Within a round the calls (sequential) share one time ceiling, `AI_TOOL_ROUND_TIMEOUT_MS` (60 s, TASK-166,
  decision `ai_tool_round_timeout`): live Market tools wait on Partner API reports and quotas, and the seller is
  waiting in the chat. A call past the deadline is answered `TOOL_TIMEOUT_TEXT` via `Promise.race`; calls after
  it in the same round are not started. The underlying request is not cancelled (FBY memo picks it up next time).
  Every tool call gets a `tool` reply with its id (Polza rejects the next request otherwise); a throwing tool
  becomes an error _for the model_, not a broken dialog. The loop lives here and the tools in
  `src/modules/ai-tools/` (rules — its README) because `AiModule` is imported by the monitor and the admin
  page, which have no business pulling finance and Market in.
- **`AiService.balance()` (TASK-105) is the second, system door** — for the self-check only
  (`HealthMonitorService`, a check registered only when `polzaAiEnabled`): no seller, no feature, no limit,
  no `AiUsage` row (the request is free and belongs to nobody), no report — the monitor judges the error
  (`shouldNotify`, journal row with `alert: false`). No key — `AiUnavailableError`. Not for product screens:
  a seller is never shown the owner's balance. Why — in `src/modules/health/README.md`, «Self-checks».
- **`scripts/diagnose-polza.ts` (TASK-107) is how a model gets chosen and how prod reachability gets checked.**
  It goes straight to `PolzaClient`, past `AiService`: the script is not a seller, has no feature flag or
  daily limit, and must not leave an `AiUsage` row, so it never touches Mongo. No Nest at all, for the
  `diagnose-*` reason (`AppModule` would re-point the webhook).

  - **The default run makes only the free GETs** (balance and models). `--chat`, `--json` and `--tools` are
    paid and opt-in, so a stray run spends nothing. Their `max_tokens` is 16/64, which caps the cost
    (≈0,0002 ₽ on `gemini-2.5-flash-lite`).
  - **Prices come from the live `/v1/models`**, i.e. `top_provider.pricing`, ₽ per 1M tokens as 8-digit
    strings. That is why `mapModels` now returns `pricing`, `type`, `contextLength` and `structuredOutputs`.
    A model with no per-token price (or priced not in roubles) is `pricing: null`, never 0, the
    `orderPurchase` argument: unknown is not free; in the table it goes last. On 14-10-2026 that covered 71
    of 419 models, all tts/image/video, priced per item. The list mixes every model kind, so `--models`
    shows `type: 'chat'` only.
  - **`--json` checks the answer against the probe schema by hand**, without ajv: a two-field schema does
    not justify a dependency. Being listed with `structured_outputs` is a claim; the probe is the proof.
    The same with `tools`: the claim is visible in the model row and the TOOLS column, and `--tools` checks
    both directions — the model requests a function, and Polza accepts the answer with role `tool` and
    `tool_call_id`.
  - **The prod image cannot run it**: there is no `scripts/` and no ts-node (`npm ci --omit=dev`). On the
    prod host, reachability is a `fetch`/`curl` of `/v2/balance`, described above in «Диагностика».

**The «ИИ» page of the admin panel (TASK-106) — `GET /api/ai/usage?range=24h|7d|30d`,
`GET /api/ai/requests?telegramUserId=&purpose=&status=&since=&until=&limit=&skip=`.** One key, the owner
pays for everything, so «who spends on what» needs an answer that is not a Mongo shell.

- **Sums come from Mongo, one `aggregate` with `$facet`** (`AiUsageService.summary`: totals, by Moscow day,
  by seller, by `purpose`). Not summed in JS over journal pages: the figure on screen must equal Σ `costRub`
  in the collection, and paged assembly silently loses everything past the page cap. Days are grouped with
  `$dateToString … timezone: 'Europe/Moscow'` — the `moscow-day.ts` argument; empty days are filled with
  zeros in `ai-usage.domain.ts` (`fillDays`), or the bars would shift and «yesterday» would sit in an empty
  day's slot.
- `list` and `count` of the journal share one `filterOf`; the page cap is `MAX_AI_PAGE_SIZE` (100). Junk in
  `range`, `status`, dates and numbers is 400.
- **The journal is read with the summary's `since` AND `until`.** `AiService` writes the `AiUsage` row
  fire-and-forget, so a request finishing after the summary otherwise showed up as «4 rows under a total of
  3» — found on the live check, not by reading.
- **Its own module, `AiAdminModule`**, not a controller inside `AiModule`: the latter is imported by the
  monitor, the AI tools and the AI analyst, which have no business pulling in the admin guard. `AdminJwtGuard` on the
  class (`AiAdminController`). The balance goes through `AiService.balance()` — `PolzaClient` stays unexported.
- **The balance has its own 10 s race** (`AI_BALANCE_TIMEOUT_MS`): the client's timeout is 620 s, sized
  for a model answer, and one live balance request took 68 s. Any failure — no key, 401, 402, timeout —
  is `balance: null` plus a reason in words (`balanceError`); the page opens regardless and prints «—». The
  failure is **not** reported: the monitor judges the balance, and a report per page open would be an alert
  outside `shouldNotify`.
- **Nicks — one `access.list()` per response**, keyed by `telegramUserId` only (`AiUsage` has no `botId`;
  the fallback map of `QueuesController.withUsers`). Skipped when there are no rows.
- `logUserOptions` takes a structural `TRowWho` now, so the AI journal rows feed the seller filter with no
  adapter. The overview line is fetched outside `Promise.all`, the metrics precedent.
- **Prompt and answer text are not shown because they do not exist** — the response lists fields
  explicitly, and a test pins that none of them can carry text.

### Модель по назначению — `POLZA_AI_MODELS` (TASK-171)

- Черновику отзыва и сводке хватает дешёвой модели, чату с инструментами нужна сильнее. Одна
  `POLZA_AI_MODEL` заставляла платить за сильную везде. `POLZA_AI_MODELS` переопределяет её для
  отдельных `purpose`; остальные идут моделью по умолчанию.
- Выбор — в `AiService.complete` (`config.polzaAiModelFor(purpose)`): дверь к Polza одна, и
  `completeWithTools` ходит через `complete`, так что чат с инструментами покрыт тем же выбором.
- Модель уходит в `PolzaClient` **явно**. Его подстановка по умолчанию не знает `purpose`: без явной
  модели `AiUsage.model` писала бы одну модель, а запрос уходил бы другой.
- Список назначений закрытый, незнакомое — падение старта: опечатка в `purpose` иначе молча оставила
  бы дорогую модель, и узнали бы об этом по счёту. `Record` над union — компилятор требует описание
  для нового назначения.
