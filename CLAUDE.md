# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Telegram bot that bulk-updates prices and stock on Yandex Market from a user-uploaded price list
(xlsx/xls/csv). Each Telegram user stores their own Yandex Market credentials (`token`,
`campaign_id`, `business_id`) and a `priceCoefficient`; uploads are processed asynchronously
through a Bull/Redis job chain. UI text and most code comments are Russian.

Migrated from Express to NestJS on branch `nest.js`. The Express layer is gone and `tsc` is clean,
but `src` still holds unreachable leftovers — read "Dead code map" below before changing anything.

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

Typecheck with `npx tsc --noEmit` — currently **clean**. (Earlier revisions of this file mention
six pre-existing `TS2307` errors in dead files; those files are gone.)

`npm test` works: **Vitest** (not Jest), config at the repo **root** `vitest.config.ts`, transform is
**swc via `unplugin-swc`** — chosen because esbuild does not emit `emitDecoratorMetadata`, so
`@nestjs/mongoose` `@Prop()` could not infer types and every Nest-DI test died with *"Cannot
determine a type for the Bot.name field"*. `@nestjs/testing` **is** installed; `Test.createTestingModule`
works. Run a single file with `npx vitest run <file>` (or `-t "<name>"`). Note
`__tests__/vitest.config.ts` still exists but is **dead** — nothing references it.

Still broken, and not worth taking as a signal:

- `npm run lint` crashes: `eslint.config.js` imports `@eslint/compat` and `eslint-plugin-import`,
  neither of which is in `package.json`.
- `.github/workflows/nodejs.yml` calls `npm run prettier:check`, which does not exist, so CI is
  red/no-op.

## Runtime architecture

`src/main.ts` → `NestFactory.create(AppModule)`, global prefix `/api`, global `LoggerInterceptor`,
`listen(AppConfigService.port)`.

Configuration goes through `@nestjs/config` with Joi validation — **never `process.env` directly, and
never `config.get('KEY')` outside `src/config/app-config.service.ts`**. Adding a variable means: a
rule in `src/config/env.validation.ts`, a typed getter in `app-config.service.ts`, plus `.env.example`
and `docker-compose.yml`.

`AppModule` → `AppConfigModule` (first, and deliberately so — Bull's factory needs config resolved),
`CqrsModule.forRoot()` (imported but **no commands/queries exist**), `BullModule.forRootAsync`,
`DatabaseModule`, `TelegramModule`.

### Bots are wired by Nest DI

`BotRegistry` (`src/modules/telegram/bots/bot-registry.service.ts`, `OnApplicationBootstrap`) loads
`Bot` docs from Mongo — seeding one from `AppConfigService.telegramToken` if the collection is empty —
then per bot: `new Telegraf(doc.token, { telegram: { apiRoot } })` → `telegraf.catch(...)` →
`PriceChangerComposer.compose()` → `telegram.setWebhook(url)`. **No `bot.launch()`**: telegraf 4.16's
`launch({webhook})` starts a stray HTTP server per bot that nothing routes to.
`OnApplicationBootstrap` rather than `OnModuleInit` so the HTTP listener is already accepting when
Telegram sends the first update.

`apiRoot` comes from `AppConfigService.telegramApiUrl` (`TELEGRAM_API_URL`, default
`https://api.telegram.org`) — outbound Bot API calls go through **our own mirror**, not directly.
This is the single place that sets it: telegraf routes every method call *and* the `getFileLink`
download URL off `apiRoot`, so price-list downloads follow automatically. The value must be
scheme+host only — telegraf resolves `new URL('./bot<token>/<method>', apiRoot)`, which **drops** a
path prefix, so `https://h/tg` would silently 404 every call; `env.validation.ts` rejects it at
startup. Do not confuse it with `TELEGRAM_WEBHOOK_URL`, the inbound direction.

Webhook updates arrive at `TelegramController` (`POST /api/telegram/webhooks/:type/:id`) →
`TelegramService.handleWebhook` → `BotRegistry.handleUpdate`.

> The earlier `BotFather` / `BaseTelegramBot` / `PriceChangerBot` hierarchy with its manual `new`
> graph is **gone** (TASK-011). Don't reintroduce it.

**Handler pattern** (`price-changer-bot/handlers/*.handler.ts`): `@Injectable()` singletons that do
**not** store the Telegraf instance — they receive it in `register(bot)`, so one handler instance
serves any number of bots.

**Registration order is a load-bearing invariant.** `PriceChangerComposer.pipeline` is the single
source of truth and `__tests__/unit/composer-order.test.ts` pins it:

```
accessGate → start → menu → slash → adminCallbacks → adminUsers → scheduleCallbacks
           → reportCallbacks → onboardingCallbacks → callbacks → apiSettings → stockUpload
           → fallback
```

- `accessGate` is a `bot.use` and must stay **first** — a gate registered after handlers guards
  nothing, because the update never reaches it.
- **Every `bot.action` must precede `callbacks`.** `bot.action` is `on('callback_query')` plus a
  pattern match and does **not** call `next()`, so the general handler — which switches on exact
  strings and whose `default:` branch overwrites the message — swallows anything registered after
  it. That is why `adminCallbacks`, `adminUsers`, `scheduleCallbacks`, `reportCallbacks` and
  `onboardingCallbacks` all sit before it. `reportCallbacks` owns `rep:<period>:<reportKey>`, so a new
  report needs **no** new registration — «💰 Прибыль» rides it as `rep:month:profit`.
- `ApiSettingsHandler` is therefore registered **twice**, deliberately: `registerCallbacks()`
  (the store picker `store_pick:` / `store_pick_business:` and the per-step help `onboarding_help:`)
  before `callbacks`, and `register()` (the catch-all `on('text')`) after `menu`/`slash`. The two
  requirements cannot be met by one method. Merging them back breaks one of them — which is exactly
  what happened: the whole TASK-052 store picker answered
  `Неизвестная команда: store_pick:12345` until this split.
- `stockUpload` takes documents and must precede `fallback`; `fallback` last. It is the only write
  path to Partner API: `StockSyncService.sync(credentials, buffer, { telegramUserId, dryRun })` →
  `price-list.parser` → `sku-resolver` → `PUT v2/.../offers/stocks`, and it also stores purchase
  prices (see "Profit"). The options object is not cosmetic: while `dryRun` was a positional boolean,
  a forgotten third argument meant a **live** stock write where only a check was asked for, so `sync`
  now throws without `telegramUserId`.

Routing is not table-driven: reply-keyboard buttons via `bot.hears(MENU.X)`, inline buttons via one
large `switch (callbackData)` in `callback-query.handler.ts`, free text via `ApiSettingsHandler`
which self-filters (`text.startsWith('/')`, `isMenuButton(text)`). Menu labels live in exactly one
place, `price-changer-bot/menu.constants.ts`, enforced by `__tests__/unit/menu-labels.test.ts`.
`shared-commands.handler.ts` holds logic reused by the menu and slash handlers.

Adding a reply-keyboard button costs three things and the tests enforce all three: a key in `MENU`,
a row in `MENU_LAYOUT`, and a `bot.hears(MENU.<KEY>` in `menu-commands.handler.ts`. An inline-only
button must **not** get a `MENU` key (that is why `onboarding_restart` is inline).

**One screen, one text.** Every screen reachable from both a button and a slash command renders
from a single module: `help.text.ts`, `settings.text.ts`, `profile.text.ts`, plus `PENDING_TEXT` /
`rejectedText()` in `onboarding.ts` for the access statuses. This is not tidiness — each of these
started as two copies that silently drifted (the help button led to the main menu; `/settings`
offered a `settings_auto_update` button no handler answered; `/profile` and the button showed
different fields). `__tests__/unit/screens-single-source.test.ts` reads the handlers as text and
fails if an entry point stops calling the shared builder.

**Never print `campaign_id`/`business_id` to the seller.** They are not entered by hand and appear
on no screen; the same test asserts it. The admin card is the one exception — its reader is
technical — and even it leads with the store name.

**To add a bot:** extend `EBotType` in `domain.telegram.ts`, add a composer + keyboard, add a branch
in `BotRegistry`, and register any new service as a normal Nest provider.

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
(`botToken`) and messages go out through `TelegramApiService.sendMessage(botToken, chatId, text)` —
a raw `fetch` that builds its URL from `AppConfigService.telegramApiUrl`, the same mirror telegraf
uses. It is an ordinary `@Injectable()` (it was `static` until it needed the config; DI is available
because processors are Nest providers). It is the **only** hand-built Bot API URL in `src` — keep it
that way, or one path ends up bypassing the mirror while everything else works.

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

### Profit

The fifth report (`REPORT.PROFIT`) is the only screen that shows money **after** costs. It reuses the
`REDEEMED` order set (`status=DELIVERED`, `dateFilter: 'updatedAt'`) — profit is computed on money
already received, since an order in transit may never be redeemed.

- **Arithmetic lives in `reports/profit.ts`**, a pure module beside `money.ts`. Both percentages are
  taken **from the sale sum**: `net = revenue − revenue×commission% − revenue×tax% − purchase`, i.e.
  `revenue × 0.70 − purchase` at the defaults. The tax base is the customer's decision, written down
  there — taking 7% off the post-commission remainder yields 539 ₽ instead of 700 ₽ on 10 000 ₽, and
  both look equally plausible.
- **Revenue is `itemsTotal`** — goods only, the same figure the other reports print as «Товары», so
  numbers reconcile between screens. Not `Σ(item.price × count)`: that excludes subsidy compensation
  and would silently disagree with the displayed total.
- **A returned order is excluded whole, and returns come from a second endpoint.** A return *after*
  redemption does **not** move the order out of `DELIVERED` — it lives as its own entity in
  `GET v2/campaigns/{id}/returns`, so `ProfitService.returnedOrderIds` queries that method and
  `profitOf` drops those orders: goods came back, so there is no revenue, no commission, no tax and no
  cost. The check runs **before** the unknown-cost branch, or a returned order with no price-list row
  would be reported as «нет закупочной цены» and the seller would go re-upload the price list for
  nothing. The returns call is deliberately **unfiltered** — `shipmentStatuses` describes where the
  parcel is, not whether the money came back, and a July order returned in August must still leave
  July's profit; intersecting with the period is `profitOf`'s job. A failure of that endpoint is logged
  as a warning and the report still renders, uncorrected. Cancellations and non-redemptions need no
  handling: they are not `DELIVERED`.
- **An order whose cost is unknown for any item is excluded whole**, and the report says how many and
  for how much. Treating a missing cost as 0 would inflate profit invisibly — that is why
  `orderPurchase` returns `null`, not `0`, and why `normalizeRate` rejects `null` separately
  (`Number(null) === 0`, so "no rate" would have become "zero commission").
- **Cost comes from the price list the seller already uploads for stock.** `IPriceRow.price` (column E)
  was parsed and discarded before; `StockSyncService` now also upserts it into `PurchasePrice`,
  **including in «проверка» (dry-run) mode** — that writes to our Mongo, not to Partner API, so profit
  works before the first live stock write. A repeat upload updates and **never deletes** rows absent
  from the file (a price list may cover one brand only); the report prints the last upload date so
  stale cost is visible.
- **Column E is the supplier's price, not the cost.** Cost = that price minus a negotiated discount:
  4 % for «Восток», 10 % for everything else (`DEFAULT_VOSTOK_DISCOUNT_PERCENT` /
  `DEFAULT_DISCOUNT_PERCENT`). Verified on live data — without the discount the month showed a
  **117 622 ₽ loss**, with it a 34 340 ₽ profit. `VOSTOK_MARKERS` is the single place deciding what
  counts as «Восток» (price-list categories «Восток», «Командирские», «Партнер», plus «Амфибия» by
  name — all one factory).
- **The discount is applied when computing, not when storing.** `PurchasePrice.price` holds the price
  exactly as printed in the file; `applyDiscounts` turns rows into costs at report time. That is why
  `findBySkus` returns `{price, name, category}` rather than a number — the group is derived from the
  stored name/category — and why changing a percentage takes effect immediately instead of waiting for
  the next upload.
- **Rates are edited by message** — `комиссия: 23`, `налог: 7`, `скидка: 10`, `скидка восток: 4`,
  parsed by `parseRateInput` in `profit.ts`. Labels of up to three words are accepted, and the
  two-word `скидка восток` must be matched before the one-word `скидка`, or the general label eats the
  specific one. Do **not** extend `parseLabelledValue`/`TDraftField` for this: that union drives
  `DRAFT_FIELD_SET`, `ONBOARDING_STEPS` and every `switch (step)` in `onboarding.ts`, whose numeric
  validation demands 5–15 digits and would reject «23».
- `ProfitService` (`reports/profit.service.ts`) joins the two sources; `OrderReportsService` stays
  API-only. Both the button (`ReportsHandler.run`) and the daily digest (`reports.processor.ts`) must
  branch on `REPORT.PROFIT` — a divergence between them is the known complaint pattern.

### Data layer

Mongoose via `@nestjs/mongoose`. `database/database.module.ts` does `MongooseModule.forRootAsync`
(uri/dbName from `AppConfigService`) + `forFeature([Bot, User, UserAccess, ReportSchedule,
PurchasePrice, YandexMarket])` and
re-exports `MongooseModule` so feature modules can `@InjectModel`. Schemas are decorator classes in
`database/schemas/*.schema.ts` with imperative `schema.index/methods/statics` appended after
`SchemaFactory.createForClass`.

There are **no Mongoose refs** — relations are implicit:

- `UserAccess` is keyed by `(telegramUserId, botId)` — unique compound index. It also carries
  `telegramChatId`, which is a **different thing**: `botId` is the tenant, `telegramChatId` is
  `ctx.chat.id` and the only value you may pass to `sendMessage`. Do not conflate them —
  `YandexMarket.telegramChatId` historically holds the *bot's* id and is useless for messaging.
- `YandexMarket` is keyed by `telegramUserId` (typed `string`). Its `campaign_id`/`business_id`/`token`
  are `required`, so the document is created **once, complete** — partial writes throw. It also carries
  the four profit rates: `commissionPercent` (23), `taxPercent` (7), `discountPercent` (10) and
  `vostokDiscountPercent` (4) — see "Profit" below.
- `PurchasePrice` is keyed by `(telegramUserId, sku)` — unique compound index, ~4100 docs per seller.
  `sku` is the **catalog** `offerId` produced by `sku-resolver`, not the price-list name: order items
  carry `offerId`, and that is the only key on which cost joins to revenue. No `botId` — the store is
  scoped per user too.
- `User` has no service and is unreachable from the live code path.

Adding an entity means **five** registrations plus the index script: `schemas/index.ts`, `forFeature`,
the service in `providers` **and** `exports`, `services/index.ts`, and the `MODELS` list in
`scripts/sync-indexes.ts` — then `npm run db:sync-indexes` once (mongoose creates missing indexes at
connect but never alters an existing one with the same key set).

### Access control: admin approval, not subscriptions

Every user has a `UserAccess` record with status `new` → `pending` → `approved` | `rejected`.

```
new        entering credentials IS the registration; only /start + credential text allowed
pending    application sent to admins; only /start
approved   full access
rejected   credentials wiped; 24h during which even entering credentials is refused,
           then the status lazily resets to `new` on the user's next update
```

- **The gate is one `bot.use`** (`handlers/access-gate.handler.ts`), registered first. Its allow-list
  is pure logic in `bots/shared/access.domain.ts` (`canPass`, `classifyUpdate`, `isRejectionExpired`,
  `formatAdminCallback`/`parseAdminCallback`) and is unit-tested without telegraf or Mongo.
- **Admins** come from `TELEGRAM_ADMIN_IDS` (comma-separated ids). They bypass the gate; use
  `AppConfigService.isAdmin(id)`, never a hand-rolled `includes`.
- **Every status transition is one `findOneAndUpdate` with the expected status in the filter.**
  That is what makes "first admin decision wins" and application idempotency work without locks —
  the loser simply gets `null`. `__tests__/unit/user-access.service.test.ts` asserts those filters,
  because the type system cannot.
- **The application fires on the `new → pending` transition**, not on "credentials are complete" —
  completeness stays true on every subsequent save, which is why the old
  "🎉 Все настройки API заполнены!" branch fired every time.
- Credentials are accumulated in `UserAccess.draft` during registration and only then written to
  `YandexMarket` as one complete document. `draft` also carries the non-credential `store_name`,
  so the picked store's name reaches the settings document without a second API call.
  **`DRAFT_FIELDS` is built from a `Record<TDraftField, true>`, not written as an array literal** —
  the `Record` forces the compiler to demand every union member. TASK-052 widened the type and
  forgot the array (`TDraftField[]` does not require completeness), so `saveDraftField` threw on
  every successful store resolution and the user got "Произошла ошибка при обработке настроек"
  after pasting a valid token.
- **Free text routes by "is there a store yet", not by status alone.** `ApiSettingsHandler.handleText`
  sends an approved user to `editSetting` **only** when `isConfigured()` is true; otherwise the text
  goes to the wizard. An approved user without a store (access granted by hand, token not sent yet)
  otherwise hit `editSetting`, which demands a `token: …` label and answered a bare token with
  "Не понял, что именно нужно изменить" — the bot rejecting exactly what it had just asked for.
- **`/start` with no store asks for the token inline**, it does not tell the user to press
  «⚙️ Настройки API»: the bot already knows the store is missing. It sends two messages because
  Telegram allows one `reply_markup` per message — the first carries the shortened reply keyboard,
  the second the prompt with the «❓ Как получить?» inline button.
- **Onboarding asks for one thing: the token.** `campaign_id`/`business_id`/`store_name` come from
  `GET v2/campaigns` via `autofillFromToken`; when the token unlocks several stores the user picks
  by **name** (`store-picker.ts`; ids live only in `callback_data`). The `campaign_id`/`business_id`
  prompts in `onboarding.ts` are the **fallback path** shown only when auto-detection fails, and are
  worded as such — there is no "Шаг N из 3" numbering, and `__tests__/unit/onboarding.test.ts`
  pins its absence. A `YandexAuthError` from the lookup **rejects the token** (cleared via
  `clearDraftField`, re-asked with the error text); network/5xx falls back to manual entry instead.
- The admin card carries the applicant's `@username`; the admin taps it and writes to the user
  **directly in Telegram**. There is deliberately **no message relay** through the bot, hence no
  conversation state to store.

> The previous subscription system is **gone** (TASK-036) — it granted every new user a free week,
> its plan buttons charged nothing, and its only check sat in `/start`, so uploads bypassed it.
> `__tests__/unit/subscription-removed.test.ts` fails if the concept creeps back.

### Error handling

`telegraf.catch()` in `BotRegistry` logs the error with a Nest `Logger` and replies to the user.

`src/shared/decorators/TryCatch.ts` + `DecorateWith.ts` are the **pre-Nest** approach:
`@DecorateMethodsWith(TryCatch())` wrapped every own-prototype method in `try/catch → console.error`,
**swallowing the error and returning `undefined`**. It is `@deprecated` and applied to nothing
(TASK-013) — kept as a monument, because it produced errors that surfaced as `TypeError` far from
their cause. Do not reapply it.

Nest's `LoggerInterceptor` (`src/common/interceptors/logger.interceptor.ts`) covers HTTP. There is no
exception filter. Logging in newer code is Nest `Logger`; older handlers still use `console.*`.

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

`.env` (gitignored) is loaded by `ConfigModule`. `src/config/env.validation.ts` is the authoritative
list; `.env.example` documents every key. Required: `MONGODB_URL`, `MONGODB_DATABASE`, `REDIS_HOST`,
`TELEGRAM_TOKEN`, `TELEGRAM_WEBHOOK_URL`, `TELEGRAM_ADMIN_IDS`. Defaulted: `PORT`, `NODE_ENV`,
`REDIS_PORT`, `YANDEX_MARKET_BASE_URL`, `TELEGRAM_API_URL`. Optional: `REDIS_PASSWORD` (empty means
"no auth").

The two Telegram URLs are opposite directions and must not be swapped: `TELEGRAM_WEBHOOK_URL` is the
public base Telegram posts updates **to** (ngrok/vk-tunnel in dev), `TELEGRAM_API_URL` is the Bot API
mirror we send requests **to**. `TELEGRAM_WEBHOOK_URL` was called `TELEGRAM_PROXY_URL` until the real
proxy variable arrived and made the name actively misleading.

A missing or malformed variable now fails at startup with a Russian message naming it, instead of
surfacing later as a connection timeout.

`TELEGRAM_ADMIN_IDS` is a comma-separated list of numeric Telegram ids. **Each admin must press
`/start` on the bot themselves** — Telegram forbids a bot from writing first, so otherwise the
application card is rejected with 403 and the applicant waits forever.

Remaining drift: `README.md` documents `TELEGRAM_BOT_TOKEN`/`MONGODB_URI`, which the code does not
read.

## Dead code map

The Express layer (`src/routes/`, `src/middleware/`, `src/controllers/`, `src/types/express/`) is
**gone** (TASK-003), and so is the `BotFather` hierarchy (TASK-011). What remains unreachable from
`main.ts` — do not "fix" it without deciding to revive it:

- `src/services/yandex-market-api.service.ts`, `src/modules/yandex/api/**` — dead Yandex clients (above).
- `FileDataProcessorService.processFile()` — remnant of the synchronous pre-queue flow; the pipeline
  calls `parseFile`/`fetchYandexData`/`compareData` individually.
- `handlers/file-upload.handler.ts` — orphaned since TASK-009: still has the pre-DI constructor
  `(bot, botToken, service)`, is in no module, and is imported nowhere.
- `bots/shared/{BaseScene,BaseService}.ts`, `src/shared/helpers/throttle/*` — referenced nowhere.
- `src/shared/decorators/{TryCatch,DecorateWith}.ts` — `@deprecated`, applied to nothing.
- `ui/keyboard.ui.telegram.ts` — base `createMenuKeyboard()` returns `Promise.resolve(undefined)` and
  imports `Promise` **from mongoose**; only works because `PriceChangerKeyboard` overrides it.
  `createMainMenu`/`createBackMenu` are `@deprecated` (labels outside `menu.constants`).
- `__tests__/vitest.config.ts` — superseded by the root `vitest.config.ts`.
- `src/modules/yandex/index.ts` is empty. Unused deps left from templates: `@clickhouse/client`,
  `technicalindicators`, `bcrypt`, `mitt`, `express`, `body-parser`.

## Known correctness bugs (verify before relying on these paths)

- `priceCoefficient` default disagrees in four places: schema `1.2`, `PriceChanger` fallback `|| 2`,
  `yandex-api.processor.ts` `2`, and the notification/menu text treats `2` vs `1.0` as "no change".
  `updateExistingOffers` also adds a hardcoded `+ 5 ₽` that `createNewOffers` does not.
- Upload validation was lost in the migration: the new
  `modules/telegram/services/file-upload.service.ts` dropped the 10 MB cap, extension/MIME
  allow-lists, and the 24h temp-file cleanup that `src/modules/telegram/README.md` still documents.
- `YandexMarketService.upsertByTelegramUser` is find-then-create, not a real upsert — race-prone.
  Don't copy the pattern; `UserAccessService` uses `upsert: true` deliberately.
- Dead user-facing copy still sits in `shared-commands.handler.ts`, `file-upload.handler.ts`,
  `notifications.processor.ts`, `file-processing.processor.ts`, `yandex-api.processor.ts` and
  `ui/keyboard.ui.telegram.ts` — price-coefficient screens, CSV/10 MB upload instructions,
  "Скачать пример". None of it is reachable (the Bull pipeline is off, the handlers are in no
  module), but it reads like live copy. Do not audit or "fix" its wording; delete it with the
  handlers when the dead code goes.
- `api-settings.handler.ts` passes `ctx.botInfo.id` as `telegramChatId` when writing `YandexMarket`,
  so that column holds the **bot's** id, not a chat. Use `UserAccess.telegramChatId` for messaging.
- Product creation hardcodes the watch domain (`'Наручные часы ' + offer.name`) in
  `price.changer.handler.ts`.

## Module docs

Russian, partly stale but useful for intent: `src/modules/telegram/README.md` (commands, file
limits), `src/modules/yandex/README.md` (50-offer batching rationale), `src/modules/parser/README.md`
(SKU patterns, UTF-8/Windows-1251 encoding fixes).
