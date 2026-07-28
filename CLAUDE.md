# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Telegram bot that bulk-updates prices and stock on Yandex Market from a user-uploaded price list
(xlsx/xls/csv). Each Telegram user stores their own Yandex Market credentials (`token`,
`campaign_id`, `business_id`) and a `priceCoefficient`; uploads are processed asynchronously
through a Bull/Redis job chain. UI text and most code comments are Russian.

Currently **mid-migration from Express to NestJS** on branch `nest.js`. Read "Migration state"
below before changing anything — a large share of files in `src` are dead code that does not compile.

## Commands

```bash
npm run dev            # nodemon → ts-node src/main.ts (the only reliable way to run the app)
npm run lint-fix       # eslint . --fix
npm run prettier-fix   # prettier --write ./src
npm run api            # regenerate src/modules/yandex/api from api-docs/openapi/openapi.yaml (unused client — see below)
npm run parser:run     # run the xlsx parser standalone against a local file
npm run tunnel         # vk-tunnel on :3004; tunnel:ngrok for ngrok. Webhook mode needs a public URL.
docker compose up -d mongodb redis   # mongo on :27018, redis on :6379, mongo-express on :8083
```

Typecheck with `npx tsc --noEmit`. Baseline as of this writing: **6 pre-existing `TS2307` errors**,
all in dead files (`bots/shared/services/user-subscription.service.ts` ×4, `src/routes/index.ts`,
`src/services/UserService.ts`) importing the deleted `src/database/mongo/**` and
`src/modules/telegram/api/**` paths. Anything beyond those six is yours.

There is **no working build or test command**:

- `npm run build` is `ts-node src/main.ts`, i.e. it *runs* the app. `npm start` (`build && node
  dist/main.js`) and the Dockerfile `CMD` therefore never work; `dist/` is never emitted.
  `rootDir: "."` also means plain `tsc` emits `dist/src/main.js`, not `dist/main.js`.
- There is no `test` script and effectively no test suite. The runner is **Vitest** (not Jest) with
  its config at the non-default path `__tests__/vitest.config.ts`. Invocation is
  `npx vitest run --config __tests__/vitest.config.ts <file>` (or `-t "<name>"`), but both existing
  files fail to collect: `__tests__/unit/main.test.ts` imports `{ Delays, greeter }` from
  `src/main.js` (ts-starter leftovers that no longer exist), and pulling in `src/main.ts` drags in
  the Nest graph, which dies with *"Cannot determine a type for the Bot.name field"* — Vitest's
  esbuild transform does not emit `emitDecoratorMetadata`, so `@nestjs/mongoose` `@Prop()` cannot
  infer types. **Before writing tests that touch anything Nest-decorated, either switch the
  transform (`@swc/core` via `unplugin-swc`, or ts-jest + `@nestjs/testing`) or give every `@Prop()`
  an explicit `{ type: … }`.** `@nestjs/testing` is not installed.
- `npm run lint` currently crashes: `eslint.config.js` imports `@eslint/compat` and
  `eslint-plugin-import`, neither of which is in `package.json`.
- `.github/workflows/nodejs.yml` calls `npm test` and `npm run prettier:check` — both missing, so CI
  is red/no-op. Don't take CI as a signal.

## Runtime architecture

`src/main.ts` → `NestFactory.create(AppModule)`, global prefix `/api`, global `LoggerInterceptor`,
`listen(process.env.PORT || 3000)` (note: `.env` sets `PORT=3004`). `dotenv/config` is imported
directly — there is no `@nestjs/config`/`ConfigService`; everything reads `process.env` inline.

`AppModule` → `CqrsModule.forRoot()` (imported but **no commands/queries exist**),
`BullModule.forRoot({redis})`, `DatabaseModule`, `TelegramModule`.

### Bots start from a Nest lifecycle hook, then leave DI

`TelegramService.onModuleInit()` → `BotFather.boot()` → `launchBots()`.
`TelegramService` is the last DI-aware layer: it injects `Model<BotDocument>`, `SubscriptionService`,
`YandexMarketService`, `FileProcessingService` and then does `new BotFather(...)` by hand.

```
BotFather (src/modules/telegram/bots/bot.father.ts)
  Map<botType, Map<botId, ITelegramBot>>; loads all Bot docs from Mongo, seeding one from
  process.env.TELEGRAM_TOKEN if the collection is empty. getBotInstanceByType() always falls
  back to PriceChangerBot.
    └─ BaseTelegramBot (bots/shared/BaseTelegramBot.ts) — owns Telegraf instance, keyboard,
       TelegramUserService; boot() throws "not implemented"; launch() configures WEBHOOK mode:
       domain = TELEGRAM_PROXY_URL, hookPath = /api/telegram/webhooks/:type/:id
        └─ PriceChangerBot (bots/price-changer-bot/price-changer.bot.ts) — composes 5 handlers
```

Webhook updates arrive at `TelegramController` (`POST /api/telegram/webhooks/:type/:id`) →
`TelegramService.handleWebhook` → `bot.handleUpdate`. Note telegraf's `launch({webhook})` without a
`port` still starts its own `http.Server` on a random port; nothing routes to it — the Nest
controller is the real receiver.

**Handler pattern** (`price-changer-bot/handlers/*.handler.ts`): plain non-Nest classes, constructor
args `(bot, keyboard, [userService], service…)`, each exposing `setupHandlers()` that registers
telegraf listeners. `PriceChangerBot.boot()` calls them in a **deliberate, order-sensitive**
sequence (menu `hears` → slash `command` → `on(message('document'))` → `on('callback_query')` →
`ApiSettingsHandler`'s catch-all `on('text')` last). Preserve that order.

Routing is not table-driven: reply-keyboard buttons via `bot.hears('<emoji> <label>')`, inline
buttons via one large `switch (callbackData)` in `callback-query.handler.ts`, free text via
`ApiSettingsHandler` which self-filters (`text.startsWith('/')`, `isMenuButton(text)`).
`shared-commands.handler.ts` holds logic reused by the menu and slash handlers.

**To add a bot:** extend `EBotType` in `domain.telegram.ts`, add
`bots/<x>-bot/<x>.bot.ts extends BaseTelegramBot` + a keyboard, add a branch in
`BotFather.getBotInstanceByType`, and thread any new service manually through
`TelegramService` → `BotFather` → bot constructor → handler constructors (DI does not reach here).

### The upload pipeline is a 4-hop Bull chain

Queue names and job types are constants in `src/modules/telegram/index.ts` (a constants file, not a
barrel). Queues are registered with per-queue retry/backoff in `telegram.module.ts`; processors live
in `src/modules/telegram/queue/processors/`.

```
file-upload.handler.ts        getFileLink → FileUploadService.saveFile (static/temp/) → enqueue PROCESS_FILE
PROCESS_FILE                 checks YandexMarketService.isConfigured → enqueue PARSE_FILE
PARSE_FILE                   FileDataProcessorService.parseFile → SimplePriceListParser (xlsx) → FETCH_YANDEX_DATA
FETCH_YANDEX_DATA            new PriceChanger(...) → loadAllOffers() → COMPARE_DATA
COMPARE_DATA                 compareData() matches parsed sku ↔ offerId (lowercased) → UPDATE_YANDEX_OFFERS
UPDATE_YANDEX_OFFERS         updateOrCreateOffers() → update (50/batch) + create (100/batch) + zero stock → SEND_COMPLETION, deleteFile
notifications.processor.ts   SEND_PROGRESS / SEND_COMPLETION / SEND_ERROR
```

Processors have no `Telegraf` instance, so the **bot token is carried in every job payload**
(`botToken`) and messages go out through the static
`TelegramApiService.sendMessage(botToken, chatId, text)` (raw `fetch` to api.telegram.org).

### Yandex Market access

Live client: `src/modules/yandex/handlers/price.changer.handler.ts` — `PriceChanger(token,
campaign_id, business_id)` over `src/transport/http/index.ts` (axios wrapper with logging
interceptors and 5xx/network retry), delegating to `modules/yandex/services/{offer,campaign}.service.ts`.
Auth is the `Api-Key` header with the **per-user** token; a fresh `PriceChanger` is constructed per
job. `loadAllOffers` pages via `page_token`. Batch limits (50 price/stock with 1s sleep, 100 create
with 2s sleep) live in `PriceChanger`.

Two dead clients exist — do not extend them: `src/modules/yandex/api/**` (generated by `npm run api`,
excluded from tsconfig, imported nowhere, and its `core/request.ts` only emits
`Authorization: Bearer`, which is wrong for Yandex) and `src/services/yandex-market-api.service.ts`
(429 lines, hardcoded base URL + Bearer auth, imported nowhere).

### Data layer

Mongoose via `@nestjs/mongoose`. `database/database.module.ts` does `MongooseModule.forRoot(MONGODB_URL,
{dbName: MONGODB_DATABASE})` + `forFeature([Bot, User, Subscription, YandexMarket])` and re-exports
`MongooseModule` so feature modules can `@InjectModel`. Schemas are decorator classes in
`database/schemas/*.schema.ts` with imperative `schema.index/methods/statics` appended after
`SchemaFactory.createForClass`.

There are **no Mongoose refs** — relations are implicit:

- `Subscription` is keyed by `(user_id, chat_id)` where **`chat_id` is the bot's id**
  (`telegram.getMe().id`), so a subscription is per (telegram user × bot).
- `YandexMarket` is keyed by `telegramUserId` (typed `string` in the schema).
- `User` has no service and is unreachable from the live code path.

Gate logic lives in `bots/shared/services/telegram-user.service.ts`: `handleUser` find-or-creates a
`Subscription` with default `plan: 'week'` (every new user gets a free week);
`checkUserSubscription` is enforced **only in `PriceChangerBot.onStart`** — the upload path and the
queue processors check nothing, so an expired user who avoids `/start` can keep uploading. Plan
prices in `callback-query.handler.ts` are display strings only; nothing charges or extends anything.

### Error handling: two coexisting strategies

`src/shared/decorators/TryCatch.ts` + `DecorateWith.ts` implement the pre-Nest approach:
`@DecorateMethodsWith(TryCatch())` on a class wraps every own-prototype method in
`try/catch → console.error`, **swallowing the error and returning `undefined`**. Applied to
`BaseTelegramBot` and `TelegramUserService`. Consequences to know:

- It neutralizes `TelegramService.handleWebhook`'s `BadRequestException` (`handleUpdate` never throws).
- It only walks the decorated class's own prototype, so subclass overrides
  (`PriceChangerBot.launch/onStart/boot`) are **not** wrapped.
- `TelegramUserService.handleUser` throws deliberately, the decorator eats it, and
  `PriceChangerBot.onStart`'s `if (!userSubscription)` branch depends on that swallowed throw.

Nest's `LoggerInterceptor` (`src/common/interceptors/logger.interceptor.ts`, `console.log`-based)
sits alongside it. There is no exception filter. Logging everywhere is `console.*`, not Nest `Logger`.

## Conventions

- **Relative imports only.** `tsconfig.json` defines no `paths`/`baseUrl`; all ~500 imports in `src`
  are `./`/`../` with no extensions. Do not introduce aliases.
- TypeScript is deliberately loose: no `strict`, `strictNullChecks: false`, `noImplicitAny: false`,
  `module`/`moduleResolution: node16`, decorators + `emitDecoratorMetadata` on. CommonJS (no
  `"type": "module"`).
- ESLint (flat config, type-aware) enforces `@typescript-eslint/consistent-type-imports`
  (use `import type`), `no-floating-promises`, `no-non-null-assertion`,
  `no-unnecessary-condition`, `max-len` 120, `import/order` (alphabetized, newlines between groups),
  `no-nested-ternary`. Prettier: single quotes, semicolons, trailing commas; its `max_line_length`
  key is not a real option, so effective print width is 80 and conflicts with eslint's 120.
- Don't edit `src/modules/yandex/api/**` (generated) or the checked-in compiled `.js` files next to
  sources in `__tests__/`.

## Environment

`.env` (gitignored) is loaded by `dotenv/config`. `.env.example` is incomplete. Names the code
actually reads: `PORT`, `MONGODB_URL`, `MONGODB_DATABASE`, `TELEGRAM_TOKEN`, `TELEGRAM_PROXY_URL`,
`YANDEX_MARKET_BASE_URL`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`.

Beware three sources of drift: `README.md` documents `TELEGRAM_BOT_TOKEN`/`MONGODB_URI` (wrong);
`docker-compose.yml` supplies `MONGODB_URI` and `REDIS_URL` (neither is read by the code, so the
`app` service is misconfigured); `.env.example` omits the Redis and Yandex vars.

## Migration state — dead code map

`src/` mixes the new Nest layout with the pre-Nest tree. These are unreachable from `main.ts` and
several do not compile (nothing typechecks the repo, so it goes unnoticed). Do not "fix" them
without deciding to revive them:

- Legacy Express layer: `src/routes/`, `src/middleware/`, `src/controllers/`, `src/services/UserService.ts`,
  `src/transport/http/test-post.ts`, `src/types/express/`. Several import deleted
  `src/database/mongo/**` or `src/modules/telegram/api/**` paths.
- `bots/shared/services/user-subscription.service.ts` — stale duplicate of
  `telegram-user.service.ts` exporting the **same class name** `TelegramUserService`, with dead
  `database/mongo` imports. The live file is `telegram-user.service.ts`.
- `src/services/yandex-market-api.service.ts`, `src/modules/yandex/api/**` — dead Yandex clients (above).
- `FileDataProcessorService.processFile()` — remnant of the synchronous pre-queue flow; the pipeline
  calls `parseFile`/`fetchYandexData`/`compareData` individually.
- `bots/shared/{BaseScene,BaseService}.ts`, `src/shared/helpers/throttle/*` — referenced nowhere.
- `ui/keyboard.ui.telegram.ts` — base `createMenuKeyboard()` returns `Promise.resolve(undefined)` and
  imports `Promise` **from mongoose**; only works because `PriceChangerKeyboard` overrides it.
- `src/modules/yandex/index.ts` is empty. Unused deps left from templates: `@clickhouse/client`,
  `technicalindicators`, `bcrypt`, `joi`, `mitt`, `express`, `body-parser`.

## Known correctness bugs (verify before relying on these paths)

- `database/services/subscription.service.ts` reads/writes an `isActive` field **absent from the
  schema**, so `getActiveSubscriptions()` always returns `[]`; some updates write `updatedAt` while
  the schema declares `updated_at`.
- `createSubscription`'s plan switch has no `'day'` case → a `day` plan expires immediately.
- `priceCoefficient` default disagrees in four places: schema `1.2`, `PriceChanger` fallback `|| 2`,
  `yandex-api.processor.ts` `2`, and the notification/menu text treats `2` vs `1.0` as "no change".
  `updateExistingOffers` also adds a hardcoded `+ 5 ₽` that `createNewOffers` does not.
- Upload validation was lost in the migration: the new
  `modules/telegram/services/file-upload.service.ts` dropped the 10 MB cap, extension/MIME
  allow-lists, and the 24h temp-file cleanup that `src/modules/telegram/README.md` still documents.
- Product creation hardcodes the watch domain (`'Наручные часы ' + offer.name`) in
  `price.changer.handler.ts`.

## Module docs

Russian, partly stale but useful for intent: `src/modules/telegram/README.md` (commands, file
limits), `src/modules/yandex/README.md` (50-offer batching rationale), `src/modules/parser/README.md`
(SKU patterns, UTF-8/Windows-1251 encoding fixes).
