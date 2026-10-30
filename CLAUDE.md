# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**This file is deliberately short.** It holds only what every task needs: commands, the skeleton, and
the invariants that break prod when violated. The rules **and the reasons behind them** for each area
live in the README next to the code (map at the bottom) — read the module's README before changing
it. When you learn something module-specific, write it there, not here.

## What this is

Telegram bot + web CRM for Yandex Market sellers (Ozon and WB being added): order reports, profit,
stock writes from an uploaded price list, a finance journal (P&L, taxes, cash flow), AI analyst.
Each seller stores their own marketplace credentials. NestJS, Mongo (everything) + Postgres
(finance only), Bull/Redis queues, telegraf. UI text and most comments are Russian.

## Commands

```bash
npm run dev                  # nodemon → ts-node src/main.ts
npm run build && npm start   # nest build + vite builds → dist/, node dist/main.js
npx tsc --noEmit             # typecheck (clean)
npm test                     # Vitest, root vitest.config.ts, swc transform (esbuild lacks decorator metadata)
npx vitest run <file> [-t "<name>"]
npm run lint-fix && npm run prettier-fix
npm run dev:crm              # vite :5174 for web/crm/, /api → :3004 (dev:admin — :5173 for web/admin/)
npm run typecheck:crm && npm run test:crm   # web/crm/ has its own tsconfig and vitest config
npm run tunnel               # vk-tunnel :3004 (tunnel:ngrok) — webhook mode needs a public URL
docker compose up -d mongodb postgres redis # mongo :27018, postgres :5433, redis :6379, mongo-express :8083
npm run db:pg:generate       # after editing src/database/postgres/finance.schema.ts
npm run db:pg:migrate        # the app also migrates itself on start
npm run db:sync-indexes      # after adding/changing a Mongo index (mongoose never alters existing ones)
```

`scripts/*.ts` (`npx ts-node scripts/<name>.ts --user=<telegramUserId> …`) are read-only diagnostics
and one-off loaders against live data: `diagnose-{orders,returns,finance,tariffs,deep-history,polza,fby-stock}`,
`{import,pnl,cashflow,anomalies}-finance`, `load-purchase-prices`, `seed-products`,
`sync-ozon-catalog`, `preview-hosting-reminder`, `preview-stock-push`, `preview-price-set`, `backtest-forecast`, `backfill-stores`, and
`eval-ai-analyst` (paid AI eval, only with `--run`; README ai-analyst). Each documents
its flags and what it writes in its header. `clean-db` deletes data (dry run unless `--apply`; there
are no backups). Scripts never boot `AppModule` — `BotRegistry` would
re-point the live webhook.

CI (`.github/workflows/nodejs.yml`): `typecheck → lint → prettier:check → test → build`, plus
`typecheck:crm`/`test:crm`, deliberately without `--if-present`.

## Runtime skeleton

`src/main.ts` → Nest app, static `web/crm/dist` at `/crm` (registered first) and `web/admin/dist` at `/`,
global prefix `/api`, `enableShutdownHooks()`.

`AppModule`: `AppConfigModule` (first — Bull's factory needs config) → Bull → `DatabaseModule` →
auth/logs → `YandexModule` → `TelegramModule` → … → `HealthModule` (last).

- **Config:** never `process.env`, never `config.get()` outside `src/config/app-config.service.ts`.
  A new variable = Joi rule in `env.validation.ts` + typed getter + `.env.example` + `docker-compose.yml`.
  Booleans are `valid('true','false')`, not `Joi.boolean()` (the string `'false'` is truthy).
- **Data:** Mongo for everything (`src/database/README.md` — adding an entity is five registrations +
  `scripts/sync-indexes.ts`); Postgres only for finance (`src/modules/finance/README.md`). No
  Mongoose refs; `UserAccess` is keyed `(telegramUserId, botId)`, `YandexMarket` by `telegramUserId`.
- **Frontends live in `web/<app>/`** (`web/README.md`): `web/admin/` — admin panel, `web/crm/` — seller CRM.
  Any new web app goes there too (own folder, vite config, `dev:<app>`/`build:<app>`, static in `main.ts`,
  Dockerfile `COPY`, eslint globs — checklist in `web/README.md`). Both use hash routers on purpose.

## Invariants that break prod

Short form; the reasons are in the linked README. Do not "simplify" any of these away.

**Bot (`src/modules/telegram/README.md`)**

- `PriceChangerComposer.pipeline` order is pinned by `composer-order.test.ts`: `accessGate` is the
  first step that can refuse; `featureGate` right after it; **every `bot.action` before `callbacks`**
  (its `default:` swallows anything later); `fallback` last.
- Webhook mode = `telegram.setWebhook(url)` only — never `launch({webhook})` (spawns stray servers).
  Polling = `launch()` fired with `void`, never awaited (the port would never open).
- Long work never runs inside a handler — under polling it freezes the bot for everyone. Enqueue it.
- Queues: **one `@Process` per queue** (Bull sums concurrency across handlers); payloads carry
  `botId`/`telegramUserId`, **never a token** (re-read from Mongo); only `ReportsProcessor` owns
  `@OnQueueFailed` on `reports`.
- Menu labels only in `menu.constants.ts`; a reply-keyboard button = `MENU` key + `MENU_LAYOUT` row +
  `bot.hears`. One screen = one text builder shared by all entry points.
- Never show `campaign_id`/`business_id` to a seller. Blocked users get `Markup.removeKeyboard()`.

**Writes to marketplaces (`src/modules/yandex/README.md`)**

- Stock writes need `STOCK_WRITE_ENABLED=true` (required, no default — dev runs against a live store).
- FBY stocks are read-only; unknown placement counts as forbidden; the last barrier sits in
  `writeInBatches` before `getWarehouseId()`. A forbidden write degrades to a dry run.
- Stock writes enter `writeInBatches` only via `sync()` (price list) or `writeStocks()` («Передача
  остатков», `src/modules/stock-push/README.md`) — both re-resolve env and placement themselves.
- Ozon/WB stock writes go only through `OzonStockWriteService`/`WbStockWriteService.writeStocks` (registry
  `stockWrite`): env, counts and «exactly one seller FBS warehouse» are checked inside; FBO/FBW never;
  write requests bypass `withOzonRetry`/`withWbRetry` (no retries).
- Price writes go only through the registry's `priceWrite.writePrices` (YM: `YmPriceWriteService`, business-level
  `offer-prices/updates` via `postWrite`, batches ≤500): needs `PRICE_WRITE_ENABLED=true` (required, no default,
  separate from stocks), integer price > 0 checked inside, write requests without retries; YM sends the current
  `discountBase` back while in 5–99%. Rules — `src/modules/price-set/README.md`.
- `sync()` takes an options object with `telegramUserId`/`dryRun` — never positional booleans.
- Mutating POSTs go through `postWrite` (no retries — a retry could publish a duplicate public reply).

**Features & access (`src/modules/telegram/README.md`)**

- **Every new function ships behind its own feature key, `defaultEnabled: false`**, enforced by
  `featureGate` / `@RequireFeature` and listed in `crm-parity`. Dependencies via `requires`
  (anything calling AI requires `ai`). Admins bypass flags but not FBY placement.
- Status transitions are one `findOneAndUpdate` with the expected status in the filter.

**Money (`src/modules/yandex/README.md`, `src/modules/finance/README.md`)**

- «Продажи» = `orderTotals` (money.ts) — the only formula; no "buyer's payment" field.
- Order profit («Лента заказов») = Σ live journal rows with the order's `orderId` − `cogsOf` (the P&L COGS rule);
  no operations → `null`, never 0. Act-summary services without an order number are not allocated to orders.
- Return losses («Аналитика возвратов») = `returnLossesOf`: reverse logistics + withholdings + unreturned commission
  (net `commission` of the returned order over all dates) − compensations; from the journal by accrual day, never
  from the «Едет обратно» reports.
- Unknown cost is `null`, never `0` (`?? 0` inflates profit invisibly).
- Reconciliation is one rule (`reconcile()`) for every marketplace; a marketplace supplies only its orders
  (`IReconcileOrders`). Act checks are YM-only.
- Finance journal is integer kopecks; journal readers default to `marketplace: 'ym'`; marketplaces
  are never mixed in one number unless the screen says so.

**CRM (`src/modules/crm/README.md`)**

- No logic in `src/modules/crm/` — delivery only; numbers come from the same services the bot uses.
- Every request passes `CrmJwtGuard`; long work goes through `crm-jobs`; the store comes from the URL
  (`scopeStore`) — the web never changes the bot's active store.
- Approved without any marketplace: login works, but only `@AllowWithoutPlatform` routes (connections,
  profile, help, auth) pass — the rest is 403 `NO_PLATFORM`. Opt-in marker; don't put it on data routes.

**Notifications (`src/modules/notifications/README.md`)**

- Dedup is stored (`SellerNotification`): one event = one notification until its coarse state changes; a rule that
  did not compute (failed, journal not loaded, incomplete stock) never resolves its active ones.
- Notification text only from `notifications.text.ts` (CRM and Telegram show the same stored title/body).
- Own queue `seller-notifications`; Telegram delivery behind its own feature `notifications_telegram`.

**AI (`src/modules/ai/README.md`)**

- `AiService` is the only door to Polza; barriers run before HTTP; no prompt/answer text is stored.
- An AI tool over a screen is visible to the model only when that screen's feature is open (`AI_TOOL_FEATURE`
  in `ai-tools.domain.ts`); tools call the screen's own service — no formula of their own. `compareMarketplaces` (and
  the period review's marketplace block) = `FinanceService.compare` over the marketplaces whose feature is open; a
  closed one or one without a journal is `insufficientData` with a reason.
- Live Market tools (`getStocks`, `getReturns`) go only through `StockLevelsService.levels` / `OrderReportsService.build`;
  the store is a name from the token's `stores` cache (`scopeStore`), never a campaign id; a tool round has a time
  ceiling (`AI_TOOL_ROUND_TIMEOUT_MS`) — past it the model gets an honest refusal.
- Answer quality (`AiTurn`, one doc per CRM turn): counters only (numbers, unconfirmed, tool calls, rounds,
  asks-back-without-tools) and the seller's 👍/👎 — no text; rating is part of the screen's feature, not its own;
  shares on the admin «ИИ» page come from one Mongo aggregate without `eval` (README ai-analyst).
- Weekly AI digest in Telegram (`ai_weekly_digest`, own queue `ai-weekly-digest`, Monday 10:00 MSK for the
  previous Mon–Sun — the week is closed and the nightly finance import has already loaded Sunday): the server
  computes the facts from `FinanceService.build`, the model only retells them (one request, no tools); no
  journal for the week → no model call, no message, only a journal row. Admins are not scheduled, only by button.

**Observability (`src/modules/errors/README.md`, `src/modules/health/README.md`)**

- All errors go through `ErrorReporter` (never throws, never blocks). The health monitor runs on
  `setInterval`, independent of Mongo and Redis. Mongo uses `lazyConnection: true` — keep it, or a
  dead database means no bot and no alerts.

## Conventions

- **Relative imports only** in `src` (no `paths`/aliases). `@` alias exists only inside `web/crm/`.
- TypeScript is deliberately loose (no `strict`, `strictNullChecks: false`), node16, CommonJS,
  decorators + `emitDecoratorMetadata`. `skipLibCheck: true` (drizzle's other-dialect types).
- ESLint: `consistent-type-imports`, `no-floating-promises`, `no-non-null-assertion`,
  `no-unnecessary-condition`, `max-len` 120, `import/order`, `no-nested-ternary`. Prettier: single
  quotes, semicolons, trailing commas.
- Exhaustive key sets are `Record<Union, …>`, not array literals — so the compiler demands new members.
- Don't edit `src/modules/yandex/api/**` (generated) or compiled `.js` files in `__tests__/`.
- Commit/push only when asked.

## Environment

`src/config/env.validation.ts` is the authority; `.env.example` documents every key. A missing or
malformed variable fails startup with a Russian message naming it.

- Required: `STOCK_WRITE_ENABLED`, `PRICE_WRITE_ENABLED`, `MONGODB_URL`, `MONGODB_DATABASE`, `POSTGRES_URL`, `REDIS_HOST`,
  `TELEGRAM_TOKEN`, `TELEGRAM_ADMIN_IDS`; `TELEGRAM_WEBHOOK_URL` only when `TELEGRAM_UPDATE_MODE=webhook`.
- `TELEGRAM_WEBHOOK_URL` (inbound, Telegram → us) and `TELEGRAM_API_URL` (outbound Bot API mirror,
  scheme+host only — a path prefix is silently dropped) are opposite directions; don't swap them.
- `TELEGRAM_UPDATE_MODE` (`webhook` default | `polling`): polling exists because the Russian prod host
  cannot receive webhooks — diagnose with `getWebhookInfo`, not app logs.
- `ADMIN_PASSWORD` overrides the stored hash when set. Polza: `POLZA_AI_TOKEN` (empty = AI off),
  `POLZA_AI_MODEL` (required with a token), `POLZA_AI_MODELS` (optional `purpose=model,…` override per purpose,
  closed purpose list in `src/modules/ai/ai-purpose.ts`), `POLZA_AI_PROXY_URL`, `AI_USER_DAILY_LIMIT_RUB`.
- Each admin in `TELEGRAM_ADMIN_IDS` must press `/start` once, or application cards fail with 403.

## Dead code map

Unreachable from `main.ts` — don't "fix" without deciding to revive:

- `src/services/yandex-market-api.service.ts`, `src/modules/yandex/api/**` — dead Yandex clients
  (Bearer auth, wrong for Yandex), and `PriceChanger` (`handlers/price.changer.handler.ts`) of the dead
  chain. Live client: `YandexApiClient` (`yandex-api.client.ts`) built per seller by `YandexClientFactory`.
- The old 4-hop upload Bull chain (`PROCESS_FILE` … `UPDATE_YANDEX_OFFERS`, `notifications.processor`,
  `TelegramApiService`'s callers) — nothing enqueues it. `FileProcessingProcessor` must stay out of
  `providers`.
- `handlers/file-upload.handler.ts`, `src/shared/helpers/throttle/*`,
  `src/shared/decorators/{TryCatch,DecorateWith}.ts` (deprecated, swallowed errors — never reapply),
  `__tests__/vitest.config.ts`.
- `ui/keyboard.ui.telegram.ts` base `createMenuKeyboard()` (imports `Promise` from mongoose);
  `createMainMenu`/`createBackMenu` deprecated.
- `src/modules/imaging` — CLI only, excluded from the prod build. `src/modules/parser` — off the live path.
- Unused deps: `@clickhouse/client`, `technicalindicators`, `mitt`, `body-parser`.

## Known correctness bugs

- `priceCoefficient` default disagrees in four places (schema 1.2, fallbacks 2); `updateExistingOffers`
  adds a hardcoded `+5 ₽`. All on dead paths.
- `YandexMarketService.upsertByTelegramUser` is find-then-create — don't copy; use `upsert: true`.
- `YandexMarket.telegramChatId` holds the **bot's** id. Message via `UserAccess.telegramChatId`.
- Dead user-facing copy (price-coefficient screens, CSV/10 MB instructions) sits in dead handlers —
  don't edit its wording, delete it with them.

## Documentation map

README = the area's rules **and** the reasons (each has a «Доводы и история решений» section).

| Area | README |
|---|---|
| Bot: DI, composer order, gates, features, access, price-list upload, broadcasts, action log | `src/modules/telegram/README.md` |
| Yandex client, reports, «Продажи», returns, profit, FBY/warehouses, stock writes, Partner API screens | `src/modules/yandex/README.md` |
| Finance journal (Postgres), import, P&L, taxes, cash flow, anomalies, reconciliation | `src/modules/finance/README.md` |
| CRM API: login, guard, jobs, parity, every CRM section (incl. finance screens) | `src/modules/crm/README.md` |
| Web apps layout, adding a new one | `web/README.md` |
| CRM frontend | `web/crm/README.md` (+ skills in `.claude/skills/`) |
| Admin panel | `web/admin/README.md` |
| Products, cost history, card matching | `src/modules/products/README.md` |
| Marketplace adapter, connections | `src/modules/marketplaces/README.md` |
| «Передача остатков»: сквозной FBS-остаток и запись в ЯМ | `src/modules/stock-push/README.md` |
| «Установка цен»: наценка/файл → план → запись цен ЯМ/Ozon/WB | `src/modules/price-set/README.md` |
| Seller notifications: rules, dedup, schedule, Telegram digest; shared stock assembly (`src/modules/inventory/`) | `src/modules/notifications/README.md` |
| Ozon / Wildberries | `src/modules/ozon/README.md`, `src/modules/wb/README.md` |
| AI (Polza, `AiService`, admin «ИИ» page) / tools / analyst | `src/modules/ai/`, `ai-tools/`, `ai-analyst/` READMEs |
| Mongo data layer | `src/database/README.md` |
| Errors / self-checks / metrics | `src/modules/{errors,health,metrics}/README.md` |
| Product images (CLI) / parser | `src/modules/imaging/README.md`, `src/modules/parser/README.md` |
| Open gaps | `docs/known-gaps.md` |
