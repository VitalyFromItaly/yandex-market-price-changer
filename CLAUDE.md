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
npm run dev            # nodemon → ts-node src/main.ts (development)
npm run build && npm start   # nest build → dist/, then node dist/main.js
npm run lint-fix       # eslint . --fix
npm run prettier-fix   # prettier --write ./src
npm run api            # regenerate src/modules/yandex/api from api-docs/openapi/openapi.yaml (unused client — see below)
npm run parser:run     # run the xlsx parser standalone against a local file
npm run tunnel         # vk-tunnel on :3004; tunnel:ngrok for ngrok. Webhook mode needs a public URL.

# read-only diagnostics against a live seller's data (see "Profit")
npx ts-node scripts/diagnose-orders.ts --user=<telegramUserId> [--date=DD-MM-YYYY|--report|--unknown]
# refresh purchase prices from a price list without Telegram; writes Mongo only, never Partner API
npx ts-node scripts/load-purchase-prices.ts --user=<telegramUserId> --file=stock.xlsx
docker compose up -d mongodb redis   # mongo on :27018, redis on :6379, mongo-express on :8083
```

Typecheck with `npx tsc --noEmit` — currently **clean**. (Earlier revisions of this file mention
six pre-existing `TS2307` errors in dead files; those files are gone.)

`npm test` works: **Vitest** (not Jest), config at the repo **root** `vitest.config.ts`, transform is
**swc via `unplugin-swc`** — chosen because esbuild does not emit `emitDecoratorMetadata`, so
`@nestjs/mongoose` `@Prop()` could not infer types and every Nest-DI test died with _"Cannot
determine a type for the Bot.name field"_. `@nestjs/testing` **is** installed; `Test.createTestingModule`
works. Run a single file with `npx vitest run <file>` (or `-t "<name>"`). Note
`__tests__/vitest.config.ts` still exists but is **dead** — nothing references it.

The rest of the toolchain works now, and CI is real: `.github/workflows/nodejs.yml` runs
`typecheck → lint → prettier:check → test → build` on push **and** pull request, deliberately without
`--if-present` (it silently skipped the missing `prettier:check` for months, which is exactly how a
red-by-rights build kept looking green). `npm run lint` no longer crashes — 0 errors, ~143
`no-explicit-any` warnings. `npm run build` (`nest build`) produces `dist/` and `npm start` runs it;
`npm run dev` is still the convenient path in development, not the only working one.

## Runtime architecture

`src/main.ts` → `NestFactory.create<NestExpressApplication>(AppModule)`, `useStaticAssets` for the
admin panel (`web/dist`, see below), global prefix `/api`, global `LoggerInterceptor`,
`enableShutdownHooks()`, `listen(AppConfigService.port)`.

Configuration goes through `@nestjs/config` with Joi validation — **never `process.env` directly, and
never `config.get('KEY')` outside `src/config/app-config.service.ts`**. Adding a variable means: a
rule in `src/config/env.validation.ts`, a typed getter in `app-config.service.ts`, plus `.env.example`
and `docker-compose.yml`.

`AppModule` → `AppConfigModule` (first, and deliberately so — Bull's factory needs config resolved),
`CqrsModule.forRoot()` (imported but **no commands/queries exist**), `BullModule.forRootAsync`,
`DatabaseModule`, `AdminAuthModule`, `LogsModule`, `YandexModule`, `TelegramModule`.

### Bots are wired by Nest DI

`BotRegistry` (`src/modules/telegram/bots/bot-registry.service.ts`, `OnApplicationBootstrap`) loads
`Bot` docs from Mongo — seeding one from `AppConfigService.telegramToken` if the collection is empty —
then per bot: `new Telegraf(doc.token, { telegram: { apiRoot } })` → `telegraf.catch(...)` →
`PriceChangerComposer.compose()` → `getMe()` → registry entry → `startReceiving`.
`OnApplicationBootstrap` rather than `OnModuleInit` so the HTTP listener is already accepting when
Telegram sends the first update.

**Two intake modes, chosen by `TELEGRAM_UPDATE_MODE` (`webhook` default | `polling`).** This is not a
preference, it is network reachability. Prod runs on a Russian host (`MNOGOWEB-MSK`) where Telegram
traffic is filtered **both ways**: outbound already goes through the mirror in `TELEGRAM_API_URL`
(a KZ host), and inbound webhook delivery fails the same way — `getWebhookInfo` returned
`Connection timed out` with `pending_update_count: 7` while the app answered `HTTP/2 200` from the
open internet with a valid certificate. Polling reverses the direction and rides the mirror that
already works. Diagnose this class of outage with `getWebhookInfo`, not with app logs: the
`LoggerInterceptor` prints `Incoming Request` for **every** HTTP request, so its absence after
startup means the update never arrived.

- **`launch({webhook})` is still forbidden**: telegraf 4.16 unconditionally calls `startWebhook()` →
  `listen(port)` with no port, so each bot spawned a stray HTTP server nothing routed to (TASK-012).
  Webhook mode is `telegram.setWebhook(url)` alone, and updates arrive through `TelegramController`.
- **`launch()` without the `webhook` option is fine** — it starts no server, only `getUpdates`. Its
  promise **must not be awaited**: it resolves only after `stop()`, and Nest waits for every bootstrap
  hook before `app.listen()`, so awaiting it would mean the port never opens. `BotRegistry.startPolling`
  fires it with `void` + `.catch()`.
- The two modes are mutually exclusive on Telegram's side (`getUpdates` answers `409 Conflict` while a
  webhook is set). Switching either way is self-healing: `launch()` calls `deleteWebhook` itself, and
  `setWebhook` overwrites it back. It does **not** drop pending updates, so a backlog accumulated
  while the endpoint was unreachable is delivered on the next start.
- `BotRegistry` implements `OnApplicationShutdown` and `main.ts` calls `app.enableShutdownHooks()`.
  Without both, a container that gets SIGTERM on redeploy keeps its `getUpdates` loop alive and the
  new instance is answered `409` — which looks exactly like "deployed and the bot went silent".
- `TELEGRAM_WEBHOOK_URL` is required **only** in webhook mode (Joi `when`), so a polling deployment
  does not have to invent a fake domain.

`apiRoot` comes from `AppConfigService.telegramApiUrl` (`TELEGRAM_API_URL`, default
`https://api.telegram.org`) — outbound Bot API calls go through **our own mirror**, not directly.
This is the single place that sets it: telegraf routes every method call _and_ the `getFileLink`
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
actionLog → accessGate → featureGate → start → menu → slash → adminCallbacks → adminUsers
          → scheduleCallbacks → reportCallbacks → onboardingCallbacks → callbacks
          → apiSettings → stockUpload → fallback
```

- `accessGate` is a `bot.use` and must be the **first step that can refuse an update** — a gate
  registered after handlers guards nothing, because the update never reaches it. Only steps that
  _always_ call `next()` may precede it, and `composer-order.test.ts` pins that list
  (`NON_BLOCKING_BEFORE_GATE`) rather than pinning "accessGate is index 0".
- `actionLog` is such a step and sits **before** the gate deliberately: the most interesting entries
  are attempts by _blocked_ users, and the gate does not call `next()`, so a logger registered after
  it would never see them.
- `featureGate` sits **immediately after** `accessGate` — see "Per-feature access" below. The order
  is not cosmetic: "your application is still pending" explains more than "that function is closed",
  and to somebody with no access at all the second message is meaningless.
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
  - **The handler only validates and enqueues; `sync` runs in `stock-sync.processor.ts`** (job
    `SYNC_STOCKS` on the `file-processing` queue, `attempts: 1` — an auto-retry of a stock write
    burns the hourly Partner API quota, the `reports` queue argument). This is not an optimization:
    under polling telegraf does not fetch the next `getUpdates` batch until every update of the
    current one is handled (`await Promise.all(updates.map(handleUpdate))`), so a minutes-long sync
    inside the handler froze the bot for **everyone**. The payload carries `file_id` + flags and
    deliberately **no token and no buffer**: the processor re-reads credentials from Mongo (fresh,
    and nothing secret sits in Redis failed jobs) and downloads the file itself via `getFileLink`.
    Jobs live in Redis, so a redeploy no longer loses an upload: waiting jobs survive whole, an
    active one whose worker died is re-queued by Bull's stalled-jobs mechanism (one automatic
    re-run; a second stall fails the job into the panel's «Очереди», retryable by button). A second
    file queues **behind** the first — concurrency is 1, so there is no write race and the old
    in-memory `inFlight` latch is gone; the reply names the queue position when anything is ahead.
    The error text is shared (`uploadErrorText` in `stock-report.ts`) so the enqueue path and the
    processor cannot drift. This is **not** a revival of the dead 4-hop chain below: one job, one
    processor.
- **On FBY, stocks are read-only — the rule lives in `stocks/placement.ts`.** FBS/DBS/Express keep the
  goods in the _seller's_ warehouse, so the seller reports the counts. FBY goods sit in **Market's**
  warehouse, where the count is moved by intake and sales; a number from a price list is a fiction
  about somebody else's warehouse. Without the check the write actually lands there: `getWarehouseId()`
  takes the first warehouse of the campaign without asking whose it is, and on the live account
  (business `164225008`) the FBY campaign `148704883` yields warehouse **147 «Ростов-на-Дону-1»** —
  which is in `GET v2/warehouses`, the list of Market's fulfilment warehouses. The FBS campaigns
  `148655119`/`124425371` correctly yield `1826207`/`1519714`.
  - **The file is still accepted on FBY — only the stock write is skipped.** The price list is the
    only source of purchase prices, and `PurchasePrice` is keyed by `(telegramUserId, sku)` with no
    store scope, so one upload serves every store the seller has. Refusing the file outright (as an
    earlier revision did) left an FBY-only seller with no «Прибыль» at all. `stock-upload.handler`
    therefore **warns before downloading** and then continues: cached `YandexMarket.stores` first
    (after a switch in the bot the model is known, and the picker itself runs off that cache, so the
    normal case costs no request), otherwise one `StockSyncService.placementFor()` call. The warning
    must precede the download — promising «загружаю остатки» and reporting «остатки не записаны» a
    minute later reads as a malfunction, which is why `progressText` has three states, not two.
  - **Writing stocks requires `STOCK_WRITE_ENABLED=true`, declared per deployment.** Development runs
    against the _live_ store — the token in `.env` is real — so a local run with an uploaded price
    list would move a real seller's stock, and nothing can undo it. The variable is **required with
    no default**, and a default in either direction is what makes it so: "writes allowed by default"
    eventually rewrites a live seller's stock from somebody's laptop; "writes forbidden by default"
    silently turns uploads off in production and is found a week later by complaint. A forgotten
    variable fails startup with a Russian message naming it, per the repo's env convention.
    - Deliberately **not** derived from `NODE_ENV`: "is this production" and "may this process touch
      someone else's warehouse" are different questions, and coupling them means changing the second
      by editing the first. `isProduction` stays where it is, still unused.
    - The Joi rule is `valid('true','false')`, not `Joi.boolean()` — coercion makes the string
      `'false'` truthy, and that typo would enable writes silently. Same reason as
      `TELEGRAM_UPDATE_MODE`.
    - Checked **before** the placement, so a run with writes off does not even ask Market for the
      model.
  - **Three barriers, and the handler is not the enforcing one.** `StockSyncService.sync` resolves
    the placement itself from a live `listStores()`; the **last barrier sits inside `writeInBatches`**,
    next to the single `updateStocks` call and _before_ `getWarehouseId()`, so no future write path
    can slip past. Same argument as `featureGate` vs `featureMenuLayout`. The handler asks the
    service rather than calling `listStores` itself — the rule and the way to resolve it stay in one
    place or they drift.
  - **An unknown placement counts as forbidden everywhere**, so a failed `listStores()` blocks the
    write too. An unfair refusal is fixed by switching stores in two taps; a write onto Market's
    warehouse is fixed by nothing — Yandex does not report what applied. "Could not determine"
    gets its **own** text (`PLACEMENT_UNKNOWN`): telling a seller their store is FBY when Market is
    merely unreachable sends them to switch a store that needs no switching.
  - **A forbidden write degrades to a check rather than a refusal.** The file is still parsed and the
    purchase prices still land in **our** Mongo, so «Прибыль» works for an FBY seller. Downgrading is
    the safe direction; the opposite one is what the `dryRun` options object exists to prevent.
  - **There are four reasons not to write, so the result carries a `writeSkipReason` discriminant
    (`'placement' | 'write-disabled' | 'feature-disabled'`), not a set of booleans.** The outcome is
    identical — nothing reached Yandex — but the seller's next move differs: switch stores, resend
    without «проверка», nothing at all (writes being off is a deployment decision, so `skipAdvice`
    returns null there), or ask the admin (`feature-disabled` — the per-seller «остатки из прайса»
    flag). Flags with one outcome would leave the report unable to say which happened. `dryRun`
    stays a **separate** field on purpose: it is a request, not a refusal. Within `'placement'`,
    `placementType` distinguishes "FBY" from "could not determine". Skip order: env → feature →
    placement — an earlier refusal means Market is not even asked for the model.
  - **`getWarehouseId` picks the seller's own warehouse, it does not take the first one.** The
    `offers/stocks` response lists warehouses holding the campaign's goods, and one of them can
    belong to Market: the fulfilment warehouse on FBY, or — and this the placement rule does _not_
    catch, because the model there is a writable one — **Market's returns warehouse on FBS**, which
    `getStocks` documents outright ("возврат поступил в указанную продавцом точку возвратов и долго
    не был забран"). With the old `limit: 1` the choice was whatever Yandex listed first, so a whole
    store's stock could land on the returns warehouse. Now the probe asks for
    `WAREHOUSE_PROBE_LIMIT` and intersects with `GET v2/businesses/{id}/warehouses` — **grouped
    warehouses included**, they arrive in `warehouseGroups` and are not duplicated into `warehouses`.
    An empty intersection throws rather than falling back to the first: writing blind is worse than
    not writing.

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

### The old upload pipeline is a 4-hop Bull chain — dead

Queue names and job types are constants in `src/modules/telegram/index.ts` (a constants file, not a
barrel). Queues are registered with per-queue retry/backoff in `telegram.module.ts`; processors live
in `src/modules/telegram/queue/processors/`. Two are alive: `reports.processor.ts` (the daily
digest) and `stock-sync.processor.ts` (the price-list upload, `SYNC_STOCKS` — see the `stockUpload`
bullet above). The chain below is the **dead** price-changing flow; nothing enqueues its job types.

```
file-upload.handler.ts        getFileLink → FileUploadService.saveFile (static/temp/) → enqueue PROCESS_FILE
PROCESS_FILE                 checks YandexMarketService.isConfigured → enqueue PARSE_FILE
PARSE_FILE                   FileDataProcessorService.parseFile → SimplePriceListParser (xlsx) → FETCH_YANDEX_DATA
FETCH_YANDEX_DATA            new PriceChanger(...) → loadAllOffers() → COMPARE_DATA
COMPARE_DATA                 compareData() matches parsed sku ↔ offerId (lowercased) → UPDATE_YANDEX_OFFERS
UPDATE_YANDEX_OFFERS         updateOrCreateOffers() → update (50/batch) + create (100/batch) + zero stock → SEND_COMPLETION, deleteFile
notifications.processor.ts   SEND_PROGRESS / SEND_COMPLETION / SEND_ERROR
```

In that dead chain processors had no `Telegraf` instance, so the **bot token was carried in every
job payload** (`botToken`) and messages went out through
`TelegramApiService.sendMessage(botToken, chatId, text)` — a raw `fetch` that builds its URL from
`AppConfigService.telegramApiUrl`, the same mirror telegraf uses. It is an ordinary `@Injectable()`
(it was `static` until it needed the config; DI is available because processors are Nest providers).
It is the **only** hand-built Bot API URL in `src` — keep it that way, or one path ends up bypassing
the mirror while everything else works. The **live** processors do it differently: the payload
carries the numeric `botId`, the bot comes from `BotRegistry.findByTelegramId`, messages go through
`bot.telegraf.telegram` (and thus through the outgoing action-log funnel), and no token ever sits
in Redis.

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

### «Едет обратно»: два источника и три грабли на возвратах

The report sums non-redemptions from the **orders** endpoint (by return substatuses) and records from
the **returns** endpoint, deduped by `orderId`. The returns half was broken three separate ways, and
each failure was silent.

- **The response shape differs between methods.** `GET .../orders` returns `{ orders, paging }` at
  the top level; `GET .../returns` returns `{ status, result: { returns, paging } }`. The client read
  `data.returns`, which was always `undefined`, so the method quietly yielded an empty list and the
  report showed only the orders half — actual returns, never. No error was ever raised: "no returns"
  is a legitimate answer, and from the outside it is indistinguishable from "we looked in the wrong
  place". `getReturns` now reads **both** levels, and a test pins the live shape.
- **Only one stage out of five was queried.** `shipmentStatuses` was `['IN_TRANSIT']`, which showed
  38 returns where the cabinet showed 50. `RETURN_STAGE` splits the five stages into `inFlight`
  (`RECEIVED`, `IN_TRANSIT`, `READY_FOR_PICKUP` — **this sum is the cabinet's number**), `declared`
  (`CREATED`) and `settled` (`PICKED`). `CREATED` is out of "in flight" **because of the data**:
  `RECEIVED + IN_TRANSIT` is exactly 50, adding `CREATED` gave 52 — and such a return can hang for
  months (one on the live account was created 19-03-2026 and had not moved since April).
- **The period was not applied at all.** The returns method takes no dates — only `pageToken`,
  `limit`, `shipmentStatuses` — so half the report was cut by `updatedAt` and half was not, and «за
  сегодня» and «с 1 числа месяца» returned the same set. That is precisely what the seller reported
  as "returns for the current month are not visible": the number had nothing to do with the month.
  Filtering now happens on our side by `creationDate` via `withinPeriod`, in Moscow calendar days
  rather than millisecond arithmetic. A return with no date counts as **outside** the period —
  silently folding a broken date into the current month is worse than dropping it, because the number
  stops matching the cabinet with nothing to explain why.
- **`PERIOD.ALL` («Всего») is not another range, it is the absence of one — and for returns it means
  ACTIVE ones, not all of them.** "Every return ever" is 1979 records of which 1928 are already
  handed to the shop: a number that answers nothing. Without a period the only useful question is
  "what is coming back to me right now", and that is the number checked against the cabinet. So
  `collectReturns` asks for `RETURN_ACTIVE_STATUSES` (the `inFlight` three) when unbounded and all
  five when a period is chosen — the period view wants the full picture of the month, closed returns
  included. Side benefit, and a large one: one page instead of twenty (5.5 s vs 27.7 s measured live).
  For **orders**, `ALL` still means whatever Partner API keeps (~30 days), so the report prints that
  caveat — «Всего» without it reads as a promise it does not keep. `ALL` stays out of
  `SCHEDULE_PERIODS`: a daily digest "for all time" would send the same number every day.
- **The report goes out as an `.xlsx` attachment** (`exportReturning` → `buildReturningWorkbook`,
  same `IReportExport` contract as «Едет до клиента»), report text as the caption, empty result as
  text with no file. **One row per item, not per order** — артикулы are the point of the export, and
  squashed into one cell they neither filter nor pivot. The two halves are asymmetric: order items
  carry `offerId`/`offerName`/`count`; the returns endpoint's `items[]` has only `shopSku` + `count`
  and **no product name** — the mapper renames `shopSku` → `offerId` (one shape downstream, pinned by
  test) and the «Товар» column stays empty rather than joined from Mongo, because
  `OrderReportsService` stays API-only. `IReturnsSummary.records` is filled at the same line as
  `count += 1`, so the file matches the message's numbers **by construction**, not by parallel
  filters. No money columns: a return item has no price of its own, and an order-level sum repeated
  per item row double-counts in the pivot tables sellers build — money is already in the caption.
  Both send paths branch on `REPORT.RETURNING` (handler and `reports.processor.ts`); the digest reads
  the saved period **before** the export branch now, since this export, unlike IN_TRANSIT, is
  period-aware.

### Profit

The fifth report (`REPORT.PROFIT`) is the only screen that shows money **after** costs. It prints
**two order sets**, and they are _not_ whole-and-part — the wording in `profit-message.ts` exists to
say so:

- **Оформлено за период** (`PLACED_DEFINITION`, `dateFilter: 'creationDate'`) — the figure the seller
  sees in their Yandex cabinet. Gets the full breakdown, and its bottom line is «Ожидается чистая»:
  these orders are still in transit and some will not be redeemed.
- **Выкуплено** — the `REDEEMED` set (`status=DELIVERED`, `dateFilter: 'updatedAt'`), money already
  received. One compact line beside the main block.

The two barely overlap: today's orders are redeemed a week later, today's redemptions were placed
earlier. Showing only the redeemed set is what made the report look broken — on 30-07-2026 it printed
9 orders while the seller counted ~40 placed (the API said 11 placed / 10 redeemed that day against a
40–50/day norm, both confirmed by two independent date filters). **When there are no placed orders,
the redeemed set gets the full breakdown instead** — otherwise a report for a quiet period collapses
into one line and loses commission, tax and cost.

- `PLACED_DEFINITION` deliberately has **no key in `REPORT`**: `Object.values(REPORT)` feeds
  `OrderReportsService.keys`, so a key would mint a report button and a digest row nobody asked for.
  `OrderReportsService.collectPlacedOrders` returns `{orders, cancelled}` — `CANCELLED` is requested
  in the same call and split locally, then printed as «Отменено: N». The cabinet lists cancelled
  orders too; staying silent about them would put our count below the seller's, which is the whole
  problem this report was fixing.
- **Partner API forbids some statuses in the `status` filter**: `PLACING`, `RESERVED`, `PENDING`,
  `PARTIALLY_RETURNED`, `UNKNOWN` answer `400 Statuses [X] are not allowed` and kill the **whole**
  report. `QUERYABLE_STATUSES` + `queryStatuses(definition)` filter the request; `matchesDefinition`
  still matches the response against the definition's full list, so meaning is not bent to fit the
  transport. This was a live bug, not a theoretical one: `REPORT.RETURNING` lists
  `PARTIALLY_RETURNED`, so «Едет обратно» answered «Яндекс.Маркет отклонил запрос» from TASK-054
  onward — before it, `status[]=` was ignored by Yandex, so the forbidden value never arrived.
  Cost of the fix: partially-returned orders are not fetched; a partial return in transit is still
  visible through the returns endpoint.
- **`toDate` is exclusive** — «заказы, созданные ДО 00:00 указанного дня» — so
  `creationDateParams` always shifts the upper bound one day forward. For a single day Yandex
  stretches the range itself and the bug is invisible; for «с 1 числа по сегодня» it would silently
  drop _today's_ orders, the ones the seller opened the report for.
- **One request may span at most 30 days, so a period is cut into windows** (`periodWindows` in
  `report-period.ts`) and `collectOrders` walks them in sequence. This is not defensive coding: on
  the **31st** «с 1 числа месяца» does not fit — `updatedAt` gives 30 days minus a second and the
  creation filter, with its shift, exactly 31 — and every period report answered
  `400 interval between … is more than 30 days`, i.e. the whole report died, on that day only.
  Cutting rather than clamping keeps the month a month; the extra request happens in 31-day months
  and nowhere else.
  - **Merging deduplicates by `order.id`.** Yandex interprets window edges itself (a range shorter
    than a day is stretched to a day), so an order at the boundary would otherwise be counted twice —
    both as a unit and as money.
  - `MAX_WINDOW_DAYS` is 30 and cannot be raised: the exclusive-`toDate` shift turns a 30-calendar-day
    window into a 30-day interval exactly, the largest the API still accepts («more than 30» is
    strict).
  - `assertPeriodSupported` checks the **age** of the period's start, never its length — the length is
    the windows' job. It is also why `splitIntoWindows` in `yandex-date-window.ts` stays unused:
    that one does millisecond arithmetic over `Date`, the very thing `moscow-day.ts` avoids.
- **«Едет до клиента» prints the moment it was taken** (`на 31-07-2026 09:12 МСК`), and the same
  moment goes into the file name (`edet-do-klienta-31-07-2026-0912.xlsx`). It is a snapshot, not a
  period, and a snapshot with no timestamp cannot be checked against the cabinet at all. The file
  name carries the time for a second reason: Telegram deduplicates uploads by content and hands back
  the **previously uploaded document together with its old name**, so a fresh export could appear
  dated yesterday. When date and caption disagree, the caption is the one computed at build time.

- **Arithmetic lives in `reports/profit.ts`**, a pure module beside `money.ts`. Both percentages are
  taken **from the sale sum**: `net = revenue − revenue×commission% − revenue×tax% − purchase`, i.e.
  `revenue × 0.70 − purchase` at the defaults. The tax base is the customer's decision, written down
  there — taking 7% off the post-commission remainder yields 539 ₽ instead of 700 ₽ on 10 000 ₽, and
  both look equally plausible.
- **Revenue is `itemsTotal` + Market subsidies**, goods only. `itemsTotal` is documented as «Платёж
  покупателя» and `item.price` as «цена без учёта вознаграждения партнёру за скидки по промокодам,
  купонам и акциям (параметр `subsidies`)» — the Market's discount is paid _by the Market_ and
  **reimbursed to the seller**, so the seller's revenue exceeds what the buyer paid. Verified on the
  live store for July (394 redeemed orders, cost 1 649 259 ₽): `itemsTotal` alone gave revenue
  2 456 985 ₽ and 4 % margin, adding subsidies gave 2 877 765 ₽ and 22 % — the latter is what the
  customer described (markup ~70 %, margin ~20 %), the former read as «the store works for free».
  Commission and tax are taken from the full sum including the subsidy, matching the customer's own
  worked example (`2689 × 23 %`, `2689 × 7 %`).
  - `subsidiesTotal` (money.ts) sums the **order-level** `subsidies`, never the per-item ones: an
    item's `amount` is **per unit** (live order #58841189889 — item with `count: 2` carried 276/565,
    the order 552/1130), so summing items without `× count` understates and with it double-counts.
    `DELIVERY` is excluded — that's delivery remuneration, the same reason `itemsTotal` excludes
    `deliveryTotal`. `SUBSIDY_TYPE` lives in `report-status-map.ts` because the literal `'DELIVERY'`
    is also an order status and the "statuses are not scattered" test rightly catches it elsewhere.
  - The report prints «в т.ч. субсидии Маркета» under Продажи. The other reports show «Товары» as the
    buyer's payment, so without that line the two screens look like they disagree — for July the gap
    is 421 000 ₽.
  - Earlier revisions of this file claimed the opposite (that `itemsTotal` includes subsidy
    compensation while `Σ(item.price × count)` does not). On live data those two sums matched **to the
    rouble** (2 456 985) and neither contains subsidies.
- **A returned order is excluded whole, and returns come from a second endpoint.** A return _after_
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
- **A row missing from the catalog still yields a purchase price.** `StockSyncService` skips the
  _stock_ write when `resolveSku` finds nothing (an unknown sku 400s the whole batch) but stores the
  price anyway, keyed by the first candidate `stripBrand(name)` — the bare code is exactly what an
  order item's `offerId` carries. Dropping the row wholesale is how prices went missing: for July, 6
  of 7 skus with no cost were present in the uploaded price list with a price (`Daniel Klein 14081-4`,
  2280 ₽, row 16952) but had been removed from the catalog, while their orders remained. The report
  then asked the seller to «пришлите прайс с этими позициями» — which they already had. Stock and
  cost are independent: a zero or absent quantity does not affect the price at all.
- **Cost comes from the price list the seller already uploads for stock.** `IPriceRow.price` (column E)
  was parsed and discarded before; `StockSyncService` now also upserts it into `PurchasePrice`,
  **including in «проверка» (dry-run) mode** — that writes to our Mongo, not to Partner API, so profit
  works before the first live stock write. A repeat upload updates and **never deletes** rows absent
  from the file (a price list may cover one brand only); the report prints the last upload date so
  stale cost is visible.
- **Column E is the supplier's price, not the cost.** Cost = that price minus a negotiated
  **per-brand** discount. Verified on live data — without the discount the month showed a
  **117 622 ₽ loss**, with it a 34 340 ₽ profit. The brand registry lives in
  `reports/brands.ts` — a **leaf module with zero imports** (the `telegram-html.ts` pattern; both
  profit arithmetic and bot screens import it, so importing `profit.ts` from it would be a cycle).
  Each brand is `{title, markers, exclude?, inputLabels}`; `brandOf(row)` matches
  `${category} ${name}` against `BRAND_KEYS` **in declared order** (`vostok` first — its markers are
  the widest), with per-brand `exclude` checked before `markers` («Восток Кремлёвские» must land on
  the default discount — customer's decision). A row matching no brand → `null` → default discount.
  A drift-guard test pins that every `BRAND_PREFIXES` entry from `sku-resolver.ts` resolves to a
  brand — the two registries stay separate (different jobs: sku resolution vs discount) but may not
  silently diverge.
- **Per-seller discounts live in `YandexMarket.brandDiscounts`** — a plain-object map keyed by
  `TBrandKey` (the `UserAccess.features` pattern: only explicit decisions stored, missing key =
  default `discountPercent`). Written **only** via `updateBrandDiscount` — a `$set` dot-path with an
  `isBrandKey` whitelist (the key decides _where_ in the document to write, same argument as
  `setFeature`); mutating the nested object + `save()` loses the change without `markModified`.
  **`vostokDiscountPercent` stays in the schema as the legacy fallback**: `discountsOf(store)` in
  `profit.ts` is the single place resolving the chain `brandDiscounts[brand]` → (vostok only)
  `vostokDiscountPercent` → `discountPercent`, so sellers who configured «Восток» before the map
  existed keep their value with **no data migration** — and the untouched default still prints
  «минус 10% (Восток 4%)» in the profit report, which only lists brands whose effective percent
  differs from the default. `0` in the map is a valid discount, not "no entry"; junk entries are
  dropped per-entry, never fail the report.
- **The discount is applied when computing, not when storing.** `PurchasePrice.price` holds the price
  exactly as printed in the file; `applyDiscounts` turns rows into costs at report time (the config
  is built **once** per map, not per row). That is why `findBySkus` returns `{price, name, category}`
  rather than a number — the brand is derived from the stored name/category — and why changing a
  percentage takes effect immediately instead of waiting for the next upload.
- **Rates are edited by button, and still by message.** Both paths live in
  `api-settings.handler.ts`; rates write through `YandexMarketService.updateRate`, brand discounts
  through `updateBrandDiscount`. `TRateField` is now **three** fields (commission, tax, default
  discount) — «Восток» left the union and became an ordinary brand.
  - **By button:** the settings screen carries one inline button per rate plus one
    «🏷 Скидки по брендам» button (`BRAND_CB_MENU`, inline-only, deliberately **no `MENU` key**),
    built by `settingsKeyboardRows(store)` in `settings.text.ts` — the _same_ module as the screen
    text, and for the same reason: the screen has three entry points (`MENU.SETTINGS`, `/settings`,
    `check_settings`), and three copies of the keyboard would drift exactly as three copies of the
    text did. The value is printed **on** the button (`📉 Комиссия 23%`) rather than in a separate
    list, and `rateShortLabel` is deliberately short — Telegram truncates long captions in a
    two-button row. `RATE_CB_PATTERN`/`rateCallback`/`parseRateCallback` sit in `profit.ts` next to
    the rates themselves; the actions are registered in `registerCallbacks()`, so they are already
    ahead of the general `callback_query` switch and **no composer change was needed**.
  - **The brand screen** («🏷 Скидки по брендам», `bdisc:` codec in `brands.ts`) lists only brands
    **present in the seller's `PurchasePrice` rows** (`listNamesAndCategories` — a two-field `lean`
    projection, deliberately _not_ `distinct('category')` because brands also match by name), folded
    by `brandUsageOf` in `brand-discounts.text.ts` — the screen's single-source module (rendered
    from the settings button, after every save and after cancel). Rows outside every brand show as
    «Остальные» whose button reuses `rate:discountPercent` — one editor for the default, not two.
    Brand keys are ASCII slugs (`^[a-z0-9-]+$`, test-pinned): they travel in callback_data (64-byte
    limit), in `pendingRate` and in the Mongo `$set` path. A **legacy action**
    `rate:vostokDiscountPercent` maps the old «⌚ Восток» button (alive forever in chat history) to
    the vostok brand question.
  - **The pending question reuses `UserAccess.pendingRate`** with the value `brand:<key>` — this is
    _not_ the «23»-ambiguity the schedule fields guard against: both questions expect a bare percent
    with the same validation, only the write target differs, and the target is encoded in the value.
    `parseBrandPending` also accepts the legacy literal `vostokDiscountPercent` (→ `vostok`) so a
    question left open across the deploy resolves instead of dangling; `setPendingRate`'s whitelist
    is `isRateField(field) || parseBrandPending(field) !== null`. `handlePendingRate` still runs
    **first** of the three pending checks and still consumes **numeric input only**
    (`parseRateValue`); a date or `09:00` is not a number and reaches its own handler. Non-numeric
    text closes the question and falls through, or an open rate question would make the bot answer
    «нужно число» to everything.
  - **By message:** `комиссия: 23`, `налог: 7`, `скидка: 10` parsed by `parseRateInput`;
    `скидка восток: 4`, `скидка casio: 5` parsed by `parseBrandDiscountInput` (labels derived from
    the registry's `inputLabels`), which `editSetting` calls **before** `parseRateInput` — «частное
    раньше общего», now between two parsers instead of between two keys of one map. Do **not**
    extend `parseLabelledValue`/`TDraftField` for this: that union drives `DRAFT_FIELD_SET`,
    `ONBOARDING_STEPS` and every `switch (step)` in `onboarding.ts`, whose numeric validation demands
    5–15 digits and would reject «23».
  - **Every label and example on screen is derived, never a literal.** `rateInputLabel` /
    `brandInputLabel` are read back out of the same tables the parsers use, so a hint is always a
    label the parser accepts, and the hints print the seller's **current** value: the screen used to
    show «Комиссия 25 %» and offer `комиссия: 23` two lines below. `RATE_FIELD_SET` and `BRAND_SET`
    are `Record<Union, …>` for the `DRAFT_FIELD_SET` reason — an array literal does not force the
    union to be complete.
- `ProfitService` (`reports/profit.service.ts`) joins the sources; `OrderReportsService` stays
  API-only. It fetches both order sets with one `Promise.all`, then makes **one** `findBySkus` call
  over their union and **one** returns call shared by both `profitOf` runs — the returns endpoint is
  the report's most expensive request. Both the button (`ReportsHandler.run`) and the daily digest
  (`reports.processor.ts`) must branch on `REPORT.PROFIT` — a divergence between them is the known
  complaint pattern.
- **«🧮 По калькулятору Маркета» is a comparison line, not arithmetic** (`POST v2/tariffs/calculate`
  + offer dims/category from `getOfferMappings`; pure math in `reports/tariff-estimate.ts`, I/O in
  `ProfitService.tariffEstimateOf`). The flat `commissionPercent` stays the seller-controlled source
  of truth — the calculator is «примерный» by its own docs, so its sum prints under the commission
  line for сверка and never enters `profitOf`. Verified live (July-2026): calculator total is 23.9%
  of revenue when priced as `item.price + per-unit subsidies` vs 20.0% without — the subsidy variant
  is the one baked into `tariffPriceOf`, because real commission is charged on the subsidized price
  (the seller's own worked example, 2689 × 23%).
  - **Behind `FEATURE.TARIFF_CALC`, `defaultEnabled: false`** — the registry's designed-for case:
    experimental, opened per seller from the panel, costs 2–8 extra Partner API requests per report.
    For the comparison **line** the flag maps to no update — both callers read it themselves and
    pass `{tariffEstimate}` into `ProfitService.build`; the service deliberately does not read
    `UserAccess` (Mongo доступа is the telegram layer's business). In `ReportsHandler` an absent
    access record means admin → flag open, the `allFeaturesEnabled` argument.
  - **«🧮 Калькулятор» is also a menu button — the sixth report.** `REPORT.TARIFF_CALC` =
    `'tariff_calc'` (report key == feature key, like the other five), which buys the whole report
    machinery for free: the period picker and `rep:` callbacks, «Другой день» via
    `pendingReportDay`, `featureGate` through `REPORT_TO_FEATURE`, the schedule section and the
    daily digest (both branch on the key in `reports.handler` / `reports.processor`). Its
    definition takes the **placed** statuses (`PLACED_STATUSES`, `creationDate`, no `CANCELLED` —
    a cancelled order has no services); `PLACED_STATUSES` moved above `REPORT_DEFINITIONS` because
    the definition references it and `const` has no hoisting. The screen (single-source module
    `reports/tariff-calc-message.ts`, used by button and digest) shows the sum, the **per-service
    breakdown** (`serviceLabel` in `tariff-estimate.ts`, unknown codes print as-is — the
    `IFbySupplyRequest` precedent) sorted by amount, and a flat-rate comparison line over the same
    `coveredRevenue` base. Unlike the line inside «Прибыль», `buildTariffReport` **throws** on
    Partner API failure — this screen IS the calculator, so errors go to `replyWithError` like any
    report, not into silent omission. The button sits in the top row next to «💰 Прибыль»
    (money screens together; default-off keeps the row single-button for most sellers, and
    `withSwitchStore` may make it three for an admin — pinned in `price-changer-keyboard.test`).
  - **One estimate per report, for the main block only** — the same `placed.orders ? placed :
    redeemed` predicate as `placedIsMain`, computed after `profitOf`. `formatProfitReport` re-checks
    `estimate.scope` against the block it prints into: if the two predicates ever drift, a line with
    the wrong set's numbers is worse than no line.
  - **An order not fully priced is excluded whole** (the `orderPurchase` argument), and the ≈% uses
    `coveredRevenue` as denominator — partial coverage says «по 3 из 5 заказов» instead of silently
    understating the percent. Missing dims fall back to 11×11×11 см / 0.3 кг (watch store, customer's
    decision; live delta vs real dims ≤9 ₽/item) — so the only uncoverable case is a sku with no
    `marketCategoryId`.
  - **`frequency` is never sent**: omitted, Yandex uses the seller's actual payout schedule; a wrong
    value is `400 INVALID_PAYMENT_SETTINGS` («payout frequency WEEKLY and delay weeks null are not
    supported», live). Calculator failure degrades like the returns call: line omitted,
    `ErrorReporter` with `context: 'profit:tariffs'`.
  - **Live spec drift**: `offerIds` filter of offer-mappings takes **≤100** per request
    (`OFFER_IDS_BATCH`) — the spec says 200, the live API answers
    `400 offerIds size must be between 1 and 100`. The filter is mutually exclusive with paging, so
    `getOfferMappings` sends **no** `limit`/`page_token` (pinned by test). `campaignId` goes in the
    **body as a number**; `sellingProgram` is XOR with it and never sent. No caching yet: a report is
    ~2–8 requests against quotas of 600/min (mappings) and 100/min (calculator).
  - `npx ts-node scripts/diagnose-tariffs.ts --user=<id> [--from=DD-MM-YYYY --to=…]` — the read-only
    сверка that answered the gate questions above (leaf-category acceptance, price variant, batch
    behaviour on 400 via bisect, frequency, coverage).
- **Two read-only scripts exist for exactly the questions this report raises** (both boot
  `AppConfigModule + YandexModule` only — `AppModule` would start `BotRegistry`, whose bootstrap
  re-points the webhook away from the running bot; `AppConfigModule` must be imported explicitly,
  `@Global()` does not pull a module into a context):
  - `npx ts-node scripts/diagnose-orders.ts --user=<id>` — a day's orders broken down by status via
    **both** date filters (a mismatch between them means the filter loses orders, not that the seller
    is wrong), a 7-day histogram, the token's store list, `--report` (the real report through the real
    services) and `--unknown` (every sku with no purchase price — the message itself lists five).
  - `npx ts-node scripts/load-purchase-prices.ts --user=<id> --file=stock.xlsx` — refreshes purchase
    prices from a price list without going through Telegram. Goes through `StockSyncService.sync` with
    `dryRun: true`, so **no stock is written to Partner API** while our Mongo is updated; upserts never
    delete rows absent from the file.

### Data layer

Mongoose via `@nestjs/mongoose`. `database/database.module.ts` does `MongooseModule.forRootAsync`
(uri/dbName from `AppConfigService`) + `forFeature([Bot, User, UserAccess, ReportSchedule,
PurchasePrice, YandexMarket, ActionLog])` and
re-exports `MongooseModule` so feature modules can `@InjectModel`. Schemas are decorator classes in
`database/schemas/*.schema.ts` with imperative `schema.index/methods/statics` appended after
`SchemaFactory.createForClass`.

There are **no Mongoose refs** — relations are implicit:

- `UserAccess` is keyed by `(telegramUserId, botId)` — unique compound index. It also carries
  `telegramChatId`, which is a **different thing**: `botId` is the tenant, `telegramChatId` is
  `ctx.chat.id` and the only value you may pass to `sendMessage`. Do not conflate them —
  `YandexMarket.telegramChatId` historically holds the _bot's_ id and is useless for messaging.
  It also carries `features` — the per-user feature flags (see "Per-feature access"), a plain
  `Record<string, boolean>` with **no index**: nothing ever queries by a flag, only by the user.
- `YandexMarket` is keyed by `telegramUserId` (typed `string`). Its `campaign_id`/`business_id`/`token`
  are `required`, so the document is created **once, complete** — partial writes throw. It also carries
  the profit rates: `commissionPercent` (23), `taxPercent` (7), `discountPercent` (10), the
  per-brand map `brandDiscounts` and the legacy `vostokDiscountPercent` (4, fallback of the
  `vostok` brand) — see "Profit" below.
- `PurchasePrice` is keyed by `(telegramUserId, sku)` — unique compound index, ~4100 docs per seller.
  `sku` is the **catalog** `offerId` produced by `sku-resolver`, not the price-list name: order items
  carry `offerId`, and that is the only key on which cost joins to revenue. No `botId` — the store is
  scoped per user too.
- `User` has no service and is unreachable from the live code path.

Adding an entity means **five** registrations plus the index script: `schemas/index.ts`, `forFeature`,
the service in `providers` **and** `exports`, `services/index.ts`, and the `MODELS` list in
`scripts/sync-indexes.ts` — then `npm run db:sync-indexes` once (mongoose creates missing indexes at
connect but never alters an existing one with the same key set).

### Action log

Every update is journalled — to the console **and** to Mongo — by `ActionLogHandler`, the first step
of the pipeline. Console alone was not enough: container logs in CapRover die on restart and cannot
be queried per user, while the question is always "what did _this_ seller do". Mongo alone was not
enough either: it is exactly when the database is unreachable that a log line matters.

- **Console shows nothing about user actions without it.** The only per-update line used to come from
  `LoggerInterceptor` (`Incoming Request: POST /api/telegram/webhooks/...`) — HTTP-level, no who, no
  what. Under `TELEGRAM_UPDATE_MODE=polling` even that disappears: updates no longer arrive over HTTP.
  **Both directions are journalled**, distinguished by `direction` (`in` | `out`, default `in` so
  pre-existing rows stay meaningful). Outgoing messages are caught by wrapping `telegram.callApi` —
  the single funnel every Bot API call passes through — via `BotRegistry.installOutgoingLog`.
  Wrapping the context methods instead would mean a dozen wrappers and a silent hole in the journal
  the first time one is forgotten.
  - **The wrap is installed in _two_ places, and both are load-bearing** — telegraf 4.16 does **not**
    route `ctx.reply` through `telegraf.telegram`. On **every** update it builds a **fresh `Telegram`
    instance** (`telegraf.js`: `new Telegram(token, options, webhookResponse)`) and hands it to the
    context, so `ctx.telegram` is _not_ the singleton. `logOutgoing` wraps the **singleton**
    `telegraf.telegram` — that catches only background sends that call it directly (admin alerts,
    access notices, the scheduled digest). Handler replies are caught by a **`contextType` subclass**
    (`loggingContextType`) that wraps `callApi` of its own per-update `Telegram`. This was a real
    outage found in the DB: 160 incoming rows to **1** outgoing, and that one an admin alert — every
    `ctx.reply` from a button press was missing because only the singleton was wrapped. An earlier
    revision of this file claimed `ctx.reply` rode the singleton funnel; against telegraf 4.16.3 that
    is false. `webhookReply` is _not_ a factor — it is resolved **inside** `callApi`
    (`core/network/client.js`), so wrapping `callApi` catches it too. The two wraps never
    double-count: a reply goes through the per-update instance only, a background send through the
    singleton only.
  - **Outgoing text is stored up to `MAX_OUTGOING_LENGTH` (4096)** — one Telegram message — so a
    multi-line profit report is kept whole, not clipped to a header. Incoming stays at 200
    (`MAX_ACTION_LENGTH`): a command or callback is short. Retention is the shared 90-day TTL on
    `actionlogs`; outgoing rows inherit it with no separate setting.

- Only `OUTGOING_METHODS` are recorded. The same funnel carries `getMe`, `setWebhook`,
  `setMyCommands` and — under polling — a **continuous** `getUpdates`; without the allow-list the
  journal would consist of nothing else.
- `kind` holds the Bot API method name for outgoing rows (`sendMessage`, `answerCallbackQuery` —
  the API name, not telegraf's `answerCbQuery`). That is why `direction` is a separate field and not
  another `kind` value: sharing one field would make "show me commands" match replies too.
- **Outgoing text is masked more weakly on purpose** (`maskOutgoing`): the numeric rule is _not_
  applied. The bot sends reports where almost everything is a number, and revenue `2456985` would be
  caught by the same rule as a `campaign_id`, turning the journal into «Продажи: «скрыто» ₽». There is
  no risk: the bot only ever _receives_ the seller's token, never sends it.
- The only live outgoing path outside telegraf is `TelegramApiService` (raw `fetch`), and it is used
  solely by the **dead** notifications processor — the scheduled digest goes through
  `bot.telegraf.telegram.sendMessage`, i.e. through `callApi`.
- **Markup is stored, not stripped.** The bot sends everything with `parse_mode: HTML`, and the panel
  needs those tags to show the message the way the user saw it. Cleaning at write time is
  irreversible; cleaning at display time is not. `src/shared/telegram-html.ts` — a pure module with
  **no imports**, used by both the backend and the browser bundle — provides `toPlainText` (one-line
  table cell) and `toSafeHtml` (modal). One implementation rather than two, because that pair drifts
  silently: the panel would start showing something other than what is stored.

  - `toSafeHtml` works **from the deny side**: it neutralises every `<`/`>` first and then re-enables
    an allow-list of tags. Stripping known-bad tags instead lets any unanticipated construct through.
  - It deliberately does **not** escape `&`. The stored string is already HTML — user data was run
    through `esc()` when the message was built — so escaping again turns `&quot;` into `&amp;quot;`
    and the admin reads a literal `&quot;` instead of a quote.
  - `<a>` is rebuilt only for `http`/`https`/`tg` schemes and always gets `rel="noopener noreferrer"`;
    a rejected link stays visible as text, and its `</a>` stays text too (a live closing tag with no
    opener is litter).

- **Secrets are masked before storage** (`maskSecrets` in `bots/shared/action-log.domain.ts`), and this
  is the point of the module, not a detail: during onboarding the seller pastes the Partner API token
  as an **ordinary message**, so an unmasked journal would be a second copy of other people's
  credentials. Masked: opaque strings ≥20 chars, `токен:`/`token:`/`api_key:` values, and 5–15 digit
  runs (`campaign_id`/`business_id`, which no screen shows the seller either).
  The label regex has **no `\b`** — in JavaScript `\b` is an ASCII word boundary and does not match
  before Cyrillic «т», so with it the Russian label the bot itself asks for went unmasked. A test pins
  this.
- **`describeAction` deliberately does not reuse `classifyUpdate`** from `access.domain.ts`. That one
  answers "may this pass" (hence `/start` is its own kind); this one answers "what did the person do"
  (where `/start` is just a command). Merging them would mean a change to access rules silently
  reshapes the journal.
- The handler **awaits `next()`** to record outcome and duration, rethrows the error after recording
  it (swallowing would leave the user without a reply and `telegraf.catch` unaware), and does **not**
  await the Mongo write — `ActionLogService.record` never throws, so a dead database degrades the
  journal to console-only instead of turning a button press into "Произошла ошибка".
- Retention is a **TTL index** of `ACTION_LOG_TTL_DAYS` (90). Changing the number is not enough:
  mongoose never alters an existing index with the same key set, so it needs `npm run db:sync-indexes`.

**Reading it: the admin panel at `/`, or `GET /api/logs`.** Both sit behind `AdminJwtGuard`,
applied to the whole `LogsController` (not to individual methods — the one that gets forgotten is
the one left open).

- **Login is a Telegram id from `TELEGRAM_ADMIN_IDS`; the password is one shared secret** with **two
  sources, and `ADMIN_PASSWORD` is the one that wins.** Set — it _is_ the password, changed by
  editing the variable and restarting. Unset — generated on first boot and printed to the log
  **once**, as a banner (printing it every start would park it in CapRover's log history forever).
  - The precedence is not arbitrary. Under "Mongo wins, env only seeds the first boot", editing the
    variable in the deploy config would do **nothing**, and an admin would rotate a password that
    never rotated. Here what is written in the deploy config is what actually works after a restart.
  - **The comparison stays single**: `applyEnvPassword` writes a bcrypt hash into the same
    `AdminCredential` document, and `login()` still does one `bcrypt.compare`. A second path
    (comparing the env string directly) would be both a second place to get it wrong and a timing
    difference between two branches — and `login()` deliberately runs bcrypt even for a non-admin id
    so response time does not reveal who is in `TELEGRAM_ADMIN_IDS`.
  - The hash is rewritten **only when it no longer matches the variable**: bcrypt at cost 12 is
    ~0.3 s, and re-salting on every boot would also make "changed" indistinguishable from "untouched".
    Only `passwordHash` is updated — `jwtSecret` must survive, or every redeploy would log all admins
    out.
  - The env password is **never printed**: whoever set the variable already has it.
  - Removing the variable keeps the last password that was installed; it does not silently regenerate,
    which would leave the admin holding a password they never saw. Empty string counts as "unset"
    (the `REDIS_PASSWORD` precedent) — otherwise a forgotten `ADMIN_PASSWORD=` would be a zero-length
    password. Joi demands ≥12 characters when non-empty.
  - Lost password with no variable set = either set `ADMIN_PASSWORD` and restart, or delete the single
    document in `admincredentials` and restart.
- **Password hash and JWT secret live in Mongo** (`AdminCredential`, one document pinned by a unique
  `key`). "Generate at deploy if absent" requires surviving a restart, and an in-memory JWT secret
  would log every admin out on each redeploy — which is why `ADMIN_PASSWORD` feeds _into_ that
  document rather than replacing it. `bcrypt` at cost 12 — the package was already installed and
  unused (this file used to list it as dead template weight).
- `AdminAuthService.verify` **re-checks `sub` against `TELEGRAM_ADMIN_IDS`** instead of trusting the
  signed token: revoking an admin must close the panel now, not in seven days when the token expires.
- **`LoginThrottle`**: 5 failures per login → 15 minutes locked. One shared password behind which
  sits users' correspondence is guessable at network speed without it. The lock is checked _before_
  the password, or a locked attacker would keep guessing. Time is passed in as an argument so the
  expiry is testable without timers.
- `login()` runs `bcrypt.compare` **even for a non-admin id** — skipping it would make response time
  reveal which ids are in `TELEGRAM_ADMIN_IDS`.
- `JwtModule.register({})` carries **no** global secret: it comes from Mongo per call, so module
  initialisation order never depends on the database being up.
- The previous `ADMIN_API_TOKEN` + `X-Telegram-User-Id` scheme is **gone** — one static env secret,
  the same for everyone and forever, pasted into a browser.

Query params: `telegramUserId`, `kind`, `since`, `until`, `limit` (capped at `MAX_PAGE_SIZE`),
`skip`; the response carries `total` from the same filter as the page (`filterOf` is one method for
exactly that reason).

### Error catching

Every error goes through **one** service — `ErrorReporter`
(`src/modules/errors/error-reporter.service.ts`, in a `@Global` module) — and lands in the same
`actionlogs` collection as ordinary actions, with `status: 'error'` and `kind: 'error'`. One
collection rather than two on purpose: the question is always "what was the user doing when it
broke", and the answer is the neighbouring rows of one timeline, not a manual join of two lists by
timestamp. Extra fields: `source`, `errorType`, `stack`, `httpStatus`, `requestUrl`, `context`.

There is **no Sentry**: the cloud one is as unreachable from the Moscow host as `api.telegram.org`
(the reason `TELEGRAM_API_URL` exists), and self-hosting it means ~10 containers and ClickHouse —
larger than the bot. CapRover itself offers nothing beyond `docker logs`, which has no search, no
per-user attribution and does not survive a restart.

- `report()` **never throws and never blocks**: a catcher that crashes the app, or delays the reply
  to the user, is worse than no catcher. Callers use `void this.errors.report(...)`.
- **`telegramUserId` falls back to the string `system`** for HTTP and process failures. Not an empty
  string — that silently matches the "all users" filter.
- **Yandex errors are self-describing.** `YandexApiError.withRequest(method, url)` is filled in
  `toDomainError`, the one place where the address is known; before that it reached only the text of
  a log line, so "which request failed" was unanswerable. `source` is forced to `yandex` for these,
  whatever layer caught them — the layer stays in `context`.
- **Alerts to admins are throttled** (`AlertThrottle`, 15 min per `errorType + context`). One
  failing upstream produces a _stream_ of identical errors; without the throttle admins get a
  hundred messages and stop reading alerts entirely — the catcher would make observability worse
  than its absence. The key deliberately excludes the message text, which often carries an order id
  and would make every error look new.
- Alert delivery is wired by `ErrorAlertBridge` (`bots/error-alert.bridge.ts`) calling
  `setAlertSender` at bootstrap. A direct dependency would be a DI cycle: `BotRegistry` calls the
  reporter from `telegraf.catch`. A failure _while sending an alert_ is logged, never reported —
  otherwise it would generate another alert, forever.
- 4xx does **not** alert (client behaviour), 5xx does. Both are recorded. A **404 on an unmatched
  route** is recorded too, but tagged `source: JUNK_SOURCE` (`'scanner'`) instead of `'http'`: those
  are entirely external scanners probing the public IP for leaked secrets (`GET /.env`,
  `/.git/config`, `/.aws/credentials`) — not a seller action and not a fault. The signal is
  `!request.route` (a 404 thrown _inside_ a real controller has the route set and stays plain
  `'http'`). `ActionLogService.filterOf` **hides `scanner` from the default query** (`source: {$ne:
  'scanner'}`), so the main journal and the overview's error counter never show them; the panel's
  **«Мусор»** tab requests them explicitly with `source=scanner`. The app never served those files —
  every probe already got a bare 404; this only sorts them out of the way. The `scanner` value is a
  member of `TErrorSource`.

Wired in: global `AllExceptionsFilter`, the error branch of `LoggerInterceptor` (`tap` with a single
callback never fired on error), `process.on('unhandledRejection'|'uncaughtException')` in `main.ts`,
`@OnQueueFailed`/`@OnQueueError`, the scheduled-digest catch, `telegraf.catch`, failed outgoing
`callApi`, and the handlers that swallow their errors (`reports`, `stock-upload`) plus the silent
degradation in `ProfitService` (returns unavailable → profit is reported _too high_ with no hint in
the text).

**Known gap:** a request malformed at the HTTP level — raw non-ASCII in the query string — is
rejected by Express _before_ Nest, so no filter sees it and nothing is journalled. A properly
percent-encoded request with the same bad value is caught normally.

### The admin panel is served by Nest itself

`web/` is a Vue 3 + Vite SPA; `npm run build` is `nest build && vite build`, and
`main.ts` does `useStaticAssets(join(__dirname, '..', 'web', 'dist'))` — one repo, one image, one
container. The path resolves correctly both in prod (`/app/dist` → `/app/web/dist`) and under
ts-node in dev (`src/` → `web/dist`).

- **Vite build, not Vue from a CDN.** Prod is on a Russian host where external domains are as
  unreachable as `api.telegram.org` — a CDN-loaded panel would work on the developer's machine and be
  a blank page in production.
- Static files are served by express middleware **before** the Nest router, so `LoggerInterceptor`
  never fires for them and the log is not flooded with one line per asset.
- The global `/api` prefix is what leaves `/` free for the panel. Four screens now — an overview, the
  user list, one seller's card, and the log — so there **is** a `vue-router`, but on
  **`createWebHashHistory`**. With normal history a refresh on `/users/999/222` would go to the
  server, which has neither that file nor that route, so F5 on a seller's card would 404. That is
  fixable with an SPA fallback in the static handler, but the fallback would have to carve out
  `/api` — and any slip in it turns an API error into a silently served `index.html`. The hash never
  reaches the server: address, back button and reload all work with no backend change at all.
  Pages live in `web/src/pages/`, each fetching its own data; a shared loader in `App.vue` would mean
  the log screen fetching sellers and the seller card fetching logs.
- **Auth state is module-level `ref`s in `web/src/auth.ts`**, not Pinia — three fields do not justify
  a store, and a module `ref` _is_ the shared instance. It moved out of `App.vue` when routed pages
  stopped receiving props from it.
- The 10 s auto-refresh belongs to the log page **only**, and its `setInterval` is cleared in
  `onBeforeUnmount`: under the router the component unmounts on navigation, and a live timer would
  keep polling `/api/logs` from another screen.
- **Toggles never hold their own state.** `ToggleSwitch` renders `modelValue` and emits `change`; the
  page replaces its row with whatever `PATCH` returned. A self-toggling switch would confidently
  claim access is closed while it is open, the moment a request fails. Inside it is a real hidden
  `<input type="checkbox">`, not a `<div>` with a click handler — focus, space, screen readers and
  `:disabled` then work for free.
- Labels shared by the list and the card (`STATUS_LABEL`, `displayName`) live in
  `web/src/users.domain.ts`. Two copies would name one state differently on the two screens.
- **Navigation is a left sidebar, and it is the same colour as the canvas** — only a border divides
  them. A different background would cut the screen into "menu world" and "content world" when it is
  one surface of one tool. The active item gets a surface fill plus a 2px accent rule; that accent is
  the only colour in the chrome, everything else is weight and spacing.
- **The overview answers the two questions the panel is actually opened with** — "who is waiting on
  me" and "did anything break" — not a row of KPI cards. Pending applications lead because they are
  the only state that **blocks a human on the other side**: the seller sent a token and is sitting
  without an answer. Totals sit below with no colour and no card frames, because they are background,
  not a call to action. The empty state says «Всё спокойно», not «нет данных» — that is a good day and
  should read like one. First load is a separate branch from empty, or the screen spends half a second
  claiming all is quiet before it has asked.
- `--warn` is a third semantic colour beside `--ok`/`--danger`: an application is neither success nor
  failure, and painting it red would say something broke when the move is simply a human's.
- Any changing number carries `.tnum` (`font-variant-numeric: tabular-nums`) — counters otherwise
  jitter the layout on every refresh and table columns stop aligning by digit.
- `vite` is pinned to **5.x** in devDependencies. It was previously present only transitively via
  vitest 2.1; installing vite 6/7 would split the dependency tree.
- The JWT is kept in `sessionStorage`, not `localStorage`.
- **No component tests** — that would mean `jsdom` + `@vue/test-utils` for ~250 lines of markup. What
  needs proving (login, throttle, guard, one-shot password generation) is tested on the backend.

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
  «⚙️ Настройки»: the bot already knows the store is missing. It sends two messages because
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

### Per-feature access: approval says _whether_, flags say _what_

`UserAccess.status` is boolean — all or nothing. On top of it sits a registry of twelve features
(`src/modules/telegram/bots/shared/features.domain.ts`), each switchable **per user** from the admin
panel. This is not a second access system: `canPass(status, kind)` still answers "may this person
use the bot", `requiredFeatures(update)` answers "which function is being invoked". Merging the two
tables would mean a change to access rules silently reshapes the feature set, and the reverse.

The six report keys are **literally the values of `REPORT`** — a second taxonomy for the same six
things would drift, and the digest already keys its schedules by them (`tariff_calc` is both the
sixth report key and its feature key, same string). Plus `schedule`, the two
price-list halves `purchase_prices` / `stock_update`, `promotion` (the promo-commission editor on
the settings screen), and the two FBY-only screens `warehouses` / `fby`. `/start`, «🏠 Главное
меню», «⚙️ Настройки», «❓ Помощь», «📊 Мой профиль»,
the whole wizard and every admin button are **not** gateable: closing them locks the seller out of
their own settings, with no way to fix a token or find out whom to ask.

- **`stock_upload` was split in two** — saving purchase prices (our Mongo, feeds «Прибыль») and
  writing stocks (Partner API) are independent actions an admin must be able to close separately.
  Stale explicit `stock_upload` entries in `UserAccess.features` are inert; the new keys default on.
  Because the outcome can be partial ("parse the file but don't write stocks"), **documents are no
  longer gated by `featureGate`** (`requiredFeatures({hasDocument}) → []`) — the binary gate can only
  refuse an update whole. `stock-upload.handler` decides before downloading: both off → refusal, one
  off → that half is skipped via `savePurchasePrices` / `stockWriteAllowed` in
  `StockSyncService.sync` options, and the report explains through
  `writeSkipReason: 'feature-disabled'` (skip order: env → feature → placement) and
  `purchasePricesSkipped`. The handler bypasses both checks for admins, like the gate does.
- **`warehouses` and `fby` have TWO conditions**: the feature (default-off, staged rollout) **and**
  the active store being FBY — the screens are about Market's warehouse and are empty on
  FBS/DBS/Express. `featureMenuLayout(features, placementType)` drops the buttons when either
  condition fails (unknown placement counts as not-FBY; the `stores` cache backfills in the
  background and the button catches up on the next render). The screen handlers re-check the model
  themselves (cache first, live `placementFor` fallback — the stock-upload pattern) and refuse with
  `fbyOnlyScreenText` — a label can always be typed by hand. Admins skip the feature filter of the
  keyboard (the gate already passes them, and they have no `UserAccess` row to flip) but **not** the
  placement condition.

- **Storage is a `features` map on `UserAccess`**, not a separate collection like `ReportSchedule`.
  It is read on every update that reaches a report, and the access record is already in the gate's
  hands — a second collection would mean a second Mongo query where one suffices.
- **Only explicit admin decisions are stored.** A missing key is _not_ "off": it resolves to
  `FEATURE_META[key].defaultEnabled`. That is why flags needed no one-off migration and existing
  sellers lost nothing, and why a not-yet-proven feature can ship with `defaultEnabled: false` and
  be opened one seller at a time — `warehouses` and `fby` do exactly that; the other nine are
  `true`.
- **`FEATURE_KEYS` is built from a `Record<TFeatureKey, true>`**, for the `DRAFT_FIELD_SET` reason —
  an array literal does not force the union to be complete, and TASK-052 already paid for that.
  The key lands in a `$set` path (`features.<key>`) and arrives over HTTP, so `setFeature` whitelists
  it exactly as `saveDraftField` does.
- **`featureGate` is one `bot.use`, not a check per handler** — same argument as `accessGate`: a
  check registered in the pipeline cannot be forgotten in a new handler, because the new handler is
  registered after it. It **returns before touching Mongo** when the update maps to no feature, which
  is most updates (free text, onboarding, settings, help). It reads `UserAccess` itself rather than
  receiving it from `accessGate`: `ctx.state` is used nowhere in this repo, and introducing the
  convention for one field costs more than a read on the updates that actually reached a report.
- **The gate does not see free text**, so the two places that consume a _pending answer_ re-check the
  flag themselves: `ReportsHandler.run` (the date answering «за какой день?») and
  `ScheduleHandler.handlePendingTime` (the time answering «во сколько присылать?»). Both close the
  pending question when refusing, or the bot would answer every subsequent message with a refusal.
- **The daily digest re-checks too** (`reports.processor.ts`). A schedule enabled before the flag was
  closed stays in Redis, and without the check the closed report would keep arriving every day —
  a divergence between button and digest is the known complaint pattern here.
- Callback data uses `rep:`/`sch:`, parsed by `report-buttons.ts` — a **pure** module the codecs moved
  into, because `features.domain.ts` must stay free of Nest and telegraf. Do **not** name a feature
  callback with a `plan_` prefix and do not write «подписка» anywhere in `src`:
  `subscription-removed.test.ts` scans for both.
- **Two layers, deliberately.** `featureMenuLayout` drops closed buttons from the reply keyboard so
  nobody is led into a dead end (the `MENU_LAYOUT_UNCONFIGURED` argument), but the gate is what
  actually enforces: a label can be typed by hand and an old inline button lives in the chat history
  forever.
- **Admins bypass everything** and have no `UserAccess` row at all (the access gate returns before
  `ensure`), so `findByUserAndBot` returns `null` and defaults apply — which is also why
  `isReportEnabled(features, key)` treats an _unknown_ report key as closed but an _absent record_
  as open.
- **Editing is web-panel only**, whole controller behind `AdminJwtGuard`:
  `GET /api/access/features`, `GET /api/access/users`, `GET /api/access/users/:id?botId=`,
  `PATCH /api/access/users/:id/features`, `PATCH /api/access/users/:id/status`. The panel takes
  labels from `FEATURE_META` over the API instead of keeping its own copy — the `menu.constants.ts`
  argument. `campaign_id`/`business_id` stay out of every response; `storeName` is enough. The user
  list resolves stores with **one** `$in` query, not `isConfigured` per row the way the Telegram
  admin list does.
- **Access itself is a toggle on the same card**, `PATCH .../status` → `UserAccessService.setApproved`.
  It is deliberately _not_ `decide`/`revoke`: those filter on one expected status (`pending`,
  `approved`), which is what makes "first admin decision wins" work for the application card. A
  toggle answers a different question — "let this seller be in this state" — from `new`, `pending`
  or `rejected` alike, and a status filter would make it silently no-op on somebody who never
  applied. Closing writes `rejected` + `rejectedAt`, so the same 24 h cooldown applies as a Telegram
  revoke. The author of the decision comes from the JWT (`req.adminId`), never from the body.
- **The seller is told**, by `AccessNotifierService` — the Telegram paths always notify, and silent
  cutoff reads as a broken bot. It never throws (the seller may have blocked the bot; the panel runs
  without Telegram) and the controller does not await it: the status is already written, so a
  reachable-Telegram problem must not answer "failed" to a succeeded action. The wording comes from
  `access-decision.text.ts`, shared with both Telegram entry points and pinned by
  `access-decision-text.test.ts` — three copies of "Доступ открыт!" would drift exactly as the help
  screens once did. Revocation and application-rejection are **different** texts: a seller who was
  working has no pending application, and «Заявка отклонена» would answer something they never sent.

### Error handling

`telegraf.catch()` in `BotRegistry` logs the error with a Nest `Logger` and replies to the user.

`src/shared/decorators/TryCatch.ts` + `DecorateWith.ts` are the **pre-Nest** approach:
`@DecorateMethodsWith(TryCatch())` wrapped every own-prototype method in `try/catch → console.error`,
**swallowing the error and returning `undefined`**. It is `@deprecated` and applied to nothing
(TASK-013) — kept as a monument, because it produced errors that surfaced as `TypeError` far from
their cause. Do not reapply it.

Nest's `LoggerInterceptor` (`src/common/interceptors/logger.interceptor.ts`) covers HTTP. There is no
exception filter. Logging in newer code is Nest `Logger`; older handlers still use `console.*`.

### Product cards (`src/modules/imaging`) — CLI only, off the live path

Takes a supplier's photo of a watch on white, cuts the object out and stands it in the branded dark
scene with a shadow and a reflection. Reached only through `scripts/compose-product-image.ts`; it is
in no Nest module and the bot does not call it. The core is plain functions **because** the bot is
the next step — wrapping in `@Injectable()` must not mean rewriting.

- **The cutout is a segmentation model, not a threshold on white** (`isnet-general-use`, ONNX, local,
  ~170 MB in `assets/models/`, gitignored). A luma threshold cuts a black G-Shock fine and falls
  apart on a steel bracelet: highlights on polished steel are indistinguishable from the background,
  and the gaps between links need clearing separately from the outer contour. The model is
  **discriminative** — it answers "object or background" and draws nothing. A generative "enhancer"
  would be free to rewrite the dial lettering, and the defect would surface at the buyer.
- **Preprocessing constants are checked against rembg's sources** (`sessions/base.py`,
  `sessions/dis_general_use.py`), not written from memory: a wrong mean/std does not crash, it
  quietly degrades the mask and reads as "the model is bad". The same for the min-max stretch of the
  output and for taking output **0**, channel **0** — isnet has side decoder heads.
- **The white fringe is subtracted, not masked.** An edge pixel is a mixture of object and
  background; invisible on white, a glowing contour on the dark scene. The background is known, so
  the mixture resolves exactly: `F = (C − BG·(1 − α)) / α` (`mask-refine.ts`). This is why the
  module is worth having at all rather than a two-line ImageMagick call.
- **sharp returns a one-channel raw buffer as THREE channels.** The mask coming out of `resize` is
  expanded to sRGB, so the buffer is three times longer than declared, rows shear, and the mask
  arrives striped with a spreading fan — with no error, because sharp does not check the length.
  `toColourspace('b-w')` fixes it and the length is asserted explicitly. `extractChannel('alpha')`,
  by contrast, does return one channel. This cost a debugging session; the symptom points at the
  model and the preprocessing, which are innocent.
- **A blurred shadow is clipped by its own canvas**, so the canvas is extended by three sigmas
  _before_ `blur`, and whatever leaves the frame is cut by `clipToCanvas` — shifting the layer inwards
  would move the shadow out from under the object.
- Scene numbers live in a **JSON preset** (`assets/scenes/*.json`, Joi-validated, unknown keys
  rejected), not in the composer: a background is a consumable. `reflection.maxHeight` exists because
  `fade` is measured from the object while the podium's depth is not — without a cap, a tall watch on
  a strap reflects off the podium onto the backdrop.
- **The template PNG is committed** (2 MB) so the module works from a fresh clone; only the weights
  are fetched. The preset's numbers were fitted **by eye** against that template — `anchor.y` is the
  contact line on the podium's top face — and verified on a live G-Shock photo. A different
  background means fitting them again: where the surface is is only visible on the picture.
- **The model must not be downloaded at runtime once this moves into the bot.** Prod is on a Russian
  host where external domains are as unreachable as `api.telegram.org` — the file goes into the image
  via `COPY`.

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
list; `.env.example` documents every key. Required: `STOCK_WRITE_ENABLED`, `MONGODB_URL`,
`MONGODB_DATABASE`, `REDIS_HOST`,
`TELEGRAM_TOKEN`, `TELEGRAM_WEBHOOK_URL`, `TELEGRAM_ADMIN_IDS`. Defaulted: `PORT`, `NODE_ENV`,
`REDIS_PORT`, `YANDEX_MARKET_BASE_URL`, `TELEGRAM_API_URL`. Optional: `REDIS_PASSWORD` (empty means
"no auth") and `ADMIN_PASSWORD` (empty means "generate one and print it once"; when set it overrides
the hash in Mongo — see "The admin panel is served by Nest itself").

The two Telegram URLs are opposite directions and must not be swapped: `TELEGRAM_WEBHOOK_URL` is the
public base Telegram posts updates **to** (ngrok/vk-tunnel in dev), `TELEGRAM_API_URL` is the Bot API
mirror we send requests **to**. `TELEGRAM_WEBHOOK_URL` was called `TELEGRAM_PROXY_URL` until the real
proxy variable arrived and made the name actively misleading.

A missing or malformed variable now fails at startup with a Russian message naming it, instead of
surfacing later as a connection timeout.

`TELEGRAM_ADMIN_IDS` is a comma-separated list of numeric Telegram ids. **Each admin must press
`/start` on the bot themselves** — Telegram forbids a bot from writing first, so otherwise the
application card is rejected with 403 and the applicant waits forever.

`README.md` used to document `TELEGRAM_BOT_TOKEN`/`MONGODB_URI`, names the code never read; it was
rewritten together with the module docs and now points at `env.validation.ts` as the authority.

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
  `technicalindicators`, `mitt`, `express`, `body-parser`. (`bcrypt` is no longer among them — the
  admin panel hashes its password with it.)

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

Russian, rewritten against the current code (they used to describe the removed price-changing flow —
CSV uploads, product creation, a price coefficient, Express):

- `README.md` — what the bot does now, env vars, commands, scripts.
- `src/modules/telegram/README.md` — bots on DI, the load-bearing registration order, the access
  gate, the price-list upload, what is left alive in the Bull queues.
- `src/modules/yandex/README.md` — client rules (Api-Key, per-method versions, repeated array params,
  non-queryable statuses, pagination), the five reports, profit, stock writing.
- `src/modules/imaging/README.md` — the card pipeline, the CLI, the preset, and the rakes already
  stepped on (sharp's one-channel raw, the clipped shadow blur, the pale ghost in low-confidence
  mask areas).
- `src/modules/parser/README.md` — states plainly that the module is off the live path, and what to
  delete it together with.

They repeat the _rules_; this file keeps the _reasons_. When both change, change both.
