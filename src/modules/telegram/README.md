# 📱 Telegram-модуль

Боты, обработчики, контроль доступа и очереди. Наружу торчит один HTTP-эндпоинт — приёмник вебхуков.

## 🏗️ Структура

```
telegram/
├── bots/
│   ├── bot-registry.service.ts        поднимает по Telegraf на каждый документ Bot
│   ├── price-changer-bot/
│   │   ├── price-changer.composer.ts  ЕДИНСТВЕННЫЙ источник порядка регистрации
│   │   ├── handlers/                  @Injectable()-синглтоны с методом register(bot)
│   │   ├── menu.constants.ts          подписи кнопок — только здесь
│   │   ├── bot-commands.ts            списки команд: гостевой и полный
│   │   ├── report-buttons.ts          callback_data кнопок отчётов и рассылки
│   │   ├── help.text.ts               один текст на кнопку и на слэш-команду
│   │   ├── settings.text.ts           то же для экрана настроек
│   │   ├── profile.text.ts            то же для профиля
│   │   └── onboarding.ts              шаги ввода токена и тексты статусов доступа
│   ├── shared/access.domain.ts        чистая логика гейта: canPass, classifyUpdate…
│   ├── shared/services/               карточка заявки, персональный список команд, просьба подключить магазин
│   └── shared/features.domain.ts      реестр возможностей и пофичный доступ
├── formatting/                        экранирование и разметка сообщений
├── queue/processors/                  обработчики Bull
├── queue/services/                    планировщики рассылок, напоминания и загрузки финансов
├── services/                          TelegramApiService, файлы мёртвого конвейера
├── telegram.service.ts                TelegramService: вебхук → BotRegistry
└── telegram.controller.ts             POST /api/telegram/webhooks/:type/:id
```

## 📈 Метрики Telegram API

- Каждый вызов Bot API (все методы, включая `getUpdates`/`getMe`) замеряется в воронке `callApi`
  (`BotRegistry.installOutgoingLog`) и копится в `TelegramApiMetrics`: минутные бакеты
  `(минута, бот, метод, исход)` с гистограммой задержек, слив раз в минуту `$inc`-ом в
  `TelegramApiBucket`. Строки на вызов нет — под polling это была бы лента `getUpdates`.
- Исход — `ok`, код Telegram (`403`, `429`…) или `network` (ответа не было — признак смерти зеркала).
- Неудачная отправка пишется в журнал с кодом (`httpStatus`), `TelegramError:<код>` и
  `retry_after`; 403/400 админов не будят, 429/5xx/сеть — будят.
- Гейты помечают отказ в `ctx.state` (`markRefused`), `ActionLogHandler` пишет его полем `refusedBy`.
- Смотреть — страница «Метрики» админ-панели (`GET /api/metrics`).
- Доводы — `src/modules/metrics/README.md`, «Metrics».

## Доводы и история решений

> Перенесено из корневого `CLAUDE.md` (2026-10-18), чтобы он не грузил в каждую сессию то, что нужно
> только при работе в этом модуле. Прежние русские разделы этого README (как устроены боты, порядок
> регистрации, доступ, пофичный доступ, приём прайса, очереди Bull, «один экран — один текст»,
> добавление бота) пересказывали этот текст и слиты в него: факты, которых здесь не было, дописаны по
> месту. Разделы, которые теперь лежат в других README, указаны с путём.

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
          → healthCommand → scheduleCallbacks → reportCallbacks → quarantineCallbacks
          → feedbackCallbacks → paymentsCallbacks → marketReportsCallbacks
          → onboardingCallbacks → callbacks → apiSettings → stockUpload → fallback
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
  it. That is why `adminCallbacks`, `adminUsers`, `scheduleCallbacks`, `reportCallbacks`,
  `quarantineCallbacks`, `feedbackCallbacks`, `paymentsCallbacks`, `marketReportsCallbacks` and
  `onboardingCallbacks` all sit before it. `reportCallbacks` owns `rep:<period>:<reportKey>`, so a new
  report needs **no** new registration — «💰 Прибыль» rides it as `rep:month:profit`.
- `ApiSettingsHandler` is therefore registered **twice**, deliberately: `registerCallbacks()`
  (the store picker `store_pick:` / `store_pick_business:` and the per-step help `onboarding_help:`)
  before `callbacks`, and `register()` (the catch-all `on('text')`) after `menu`/`slash`. The two
  requirements cannot be met by one method. Merging them back breaks one of them — which is exactly
  what happened: the whole TASK-052 store picker answered
  `Неизвестная команда: store_pick:12345` until this split.
- `stockUpload` takes documents and must precede `fallback`; `fallback` last. It is the write path
  to Partner API for stocks (long the ONLY write in the app; now the quarantine confirm and the
  feedback reply/skip also mutate — see `src/modules/yandex/README.md`, «Четыре экрана из Partner
  API»): `StockSyncService.sync(credentials, buffer, { telegramUserId, dryRun })` →
  `price-list.parser` → `sku-resolver` → `PUT v2/.../offers/stocks`, and it also stores purchase
  prices (see `src/modules/yandex/README.md`, «Profit»). The options object is not cosmetic: while `dryRun` was a positional boolean,
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
    **"Concurrency is 1" was false until TASK-080.** The dead `FileProcessingProcessor` sat in
    `providers` on the same queue with three `@Process` at concurrency 3, and Bull 4 **sums** the
    concurrency of every handler of a queue (`queue.js`, `while (concurrency--)` — each loop takes a
    job of any name), so up to 10 stock writes, even two files of one seller, ran in parallel. It is
    out of `providers` now and `stock-upload-policy.test.ts` pins that; the CRM enqueues into this
    same queue precisely so that bot and web write stocks one at a time.
    The error text is shared (`uploadErrorText` in `stock-report.ts`) so the enqueue path and the
    processor cannot drift. This is **not** a revival of the dead 4-hop chain below: one job, one
    processor.
  - Кнопки нет: файл присылается документом в чат. Другие входы — «Прайс» в CRM
    (`src/modules/crm/README.md`, раздел «Прайс» в CRM) и «Передача остатков» CRM; джоба
    `sync-stocks` различает источник полем `source` (нет поля или `telegram` — бот, `crm`, `push`). Быстрые проверки до постановки: форматы `.xlsx`/`.xls`, до 10 МБ, фичи прайса,
    наличие настроек магазина, предупреждение о модели размещения. Слово `проверка` в подписи к
    файлу = сухой прогон: остатки в Partner API не уходят, но прайс сверяется с каталогом, а
    закупочные цены пишутся в нашу Mongo — прибыль считается ещё до первой боевой записи остатков.
    Позицию в очереди ответ называет так: «Перед вами в очереди: N». Дальше работает
    `StockSyncService` (`src/modules/yandex/README.md`).
- **On FBY, stocks are read-only — the rule lives in `stocks/placement.ts`.** FBS/DBS/Express keep the
  goods in the _seller's_ warehouse, so the seller reports the counts. FBY goods sit in **Market's**
  warehouse, where the count is moved by intake and sales; a number from a price list is a fiction
  about somebody else's warehouse. Without the check the write actually landed there: `getWarehouseId()`
  took the first warehouse of the campaign without asking whose it is (it now picks the seller's own —
  see the last bullet of this list), and on the live account
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
    minute later reads as a malfunction, which is why the progress text has four states
    (`TUploadProgress`), not two.
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
      model. Since TASK-080 the **early** layer checks it too (`decideUpload`): with writes off the
      bot promises «🔍 Разбираю файл — сохраню закупочные цены, остатки не трогаю…» instead of
      «⏳ Загружаю остатки» followed a minute later by «🧪 Запись остатков выключена». No warning is
      sent for it — a deployment decision, nothing for the seller to do (the `skipAdvice` argument).
  - **Three barriers, and the handler is not the enforcing one.** `StockSyncService.sync` resolves
    the placement itself from a live `listStores()`; the **last barrier sits inside `writeInBatches`**,
    next to the single `updateStocks` call and _before_ `getWarehouseId()`, so no future write path
    can slip past. Same argument as `featureGate` vs `featureMenuLayout`. The handler asks the
    service rather than calling `listStores` itself — the rule and the way to resolve it stay in one
    place or they drift.
  - **The early layer is one module for both channels** (TASK-080): `stocks/stock-upload-policy.ts`
    (pure: `UPLOAD_LIMITS`, `checkUploadFile`, `decideUpload`, and `skipReasonOf` — **moved here from
    the sync service**, which now imports it, so the early and the last layer apply literally one
    rule) plus `StockUploadPolicyService` (reads env, resolves placement: cache → `placementFor`).
    Callers pass **booleans** (`savePrices`, `stockFeatureOn`) with the admin already resolved, so
    `yandex/` does not import the bot's feature registry. The decision returns codes
    (`warning`, `progress`), and `stock-upload.texts.ts` turns them into words — the bot's texts
    moved there verbatim and the handler re-exports the old names. Only wording that points at a bot
    control differs by channel: `fbyStocksReadonlyText({plain})`, `skipAdvice(result, 'crm')`
    («…откройте магазин FBS из списка «Магазины»», «без отметки «Только проверка»») — in the CRM a
    store is opened from the list, not switched (see `src/modules/crm/README.md`, раздел «Магазины»
    в CRM), so the bot's button would
    be a false lead there.
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
in `src/modules/telegram/queue/processors/`. Twelve are alive. On the `reports` queue, besides the ones
described below, sit `payments-report`, `price-recommendations`, `offer-cards` and `market-report`
(see `src/modules/yandex/README.md`, «Четыре экрана из Partner API» and «Второй заход»). The rest:
`reports.processor.ts` (the daily
digest by `ReportSchedule`), `hosting-reminder.processor.ts` (`send-hosting-reminder`, the monthly
payment reminder — see "The one broadcast" below), `stock-sync.processor.ts` (the price-list upload,
`SYNC_STOCKS` = `sync-stocks` — see the `stockUpload` bullet above), `fby-overview.processor.ts`
(`SEND_FBY_OVERVIEW` = `send-fby-overview` on the `reports` queue — the FBY
screen waits out Market's generate→poll report cycle, minutes at worst, which used to stall the
telegraf polling loop for everyone; the poll ceiling is ~3 min now that it runs in the background.
`FbyHandler` only checks feature/placement, dedupes against the queue — the report generation limit
is 1/min — and enqueues), `profit-report.processor.ts` (`SEND_PROFIT_REPORT` = `send-profit-report`,
same queue —
«Прибыль» is the most expensive report: both order sets over 30-day windows, the returns endpoint,
the tariff calculator, tens of seconds. The `tariff_calc` flag is computed **in the handler** and
travels in the payload — an admin has no `UserAccess` row, so a blind re-check against a default-off
feature in the processor would refuse exactly them, the same reason `fby-overview.processor` does not
re-check `fby`), `tariff-report.processor.ts` (`SEND_TARIFF_REPORT` = `send-tariff-report`, same
queue and same reason — see the calculator screen in `src/modules/yandex/README.md`, «Profit») and
`warehouses-overview.processor.ts` (`SEND_WAREHOUSES_OVERVIEW` = `send-warehouses-overview`, same
queue — the warehouses screen was two instant GETs until it started printing stock under each
warehouse; that number comes from the same report, see `src/modules/yandex/README.md`,
«Warehouses»; the list of Market's warehouses can be long, so it is sent through `splitMessage`).
Beside them, `finance-import.processor.ts` (`import-finance`) runs on its **own** `finance-import`
queue: one `@Process` at concurrency 1 (two loads of one period would collide on the version
number), `attempts: 1` (the report quota is 100/h), no token in the payload; the work itself is
`FinanceImportService` (`src/modules/finance/`), written to Postgres — see
`src/modules/finance/README.md`.
`seller-notifications.processor.ts` (`check-seller-notifications`, TASK-152) runs on its **own**
`seller-notifications` queue: one repeatable job per seller at the seller's own time, one `@Process` at
concurrency 1, no token in the payload; rules, dedup and texts live in `src/modules/notifications/`
(see its README). `notifications` is taken by the dead upload pipeline's progress messages and `reports`
by ReportScheduler's reconcile, hence the third own queue.
`weekly-digest.processor.ts` (`send-ai-weekly-digest`, TASK-168) — the first AI in the bot — runs on its
**own** `ai-weekly-digest` queue for the same reason: one repeatable job per seller (`weeklydigest-<id>`,
hyphen not colon), Monday 10:00 MSK, one `@Process` at concurrency 1, its own `@OnQueueFailed`, `attempts: 1`
(a retry is a second paid Polza call and maybe a second message). There is no menu button: the processor
re-checks `ai_weekly_digest` itself (the `hosting_reminder` precedent), and `AccessController` re-reconciles on
`ai_weekly_digest`/`ai`/`finance` and status changes. Every run leaves one `ActionLog` row of kind
`ai-weekly-digest` (status and counts only) — the «Очереди» card answers «did it go out» from it.
Of the report buttons in `ReportsHandler`, **only «Прибыль» and «Калькулятор» moved to the queue**; the
four order reports are fast enough and keep `ReportsHandler`'s in-memory `inFlight` latch. All the
processors on the `reports` queue that answer a button carry `botId`/`chatId`
and never a token, re-reading credentials from Mongo, and none declares a second `@OnQueueFailed` on
the `reports` queue — `ReportsProcessor` already owns that hook and a second one would double every
journal entry. The «уже собирается» latch of the queued screens is one shared
`queue/queued-for-user.ts` and matches **its own** job name: refusing the warehouses screen because
the seller pressed «📦 FBY» a minute ago would treat a rate limit by banning the bot, and the limit
is handled where it belongs — by the single fetch loop in `FbyStockService` (see
`src/modules/yandex/README.md`, «Warehouses»). The FBY stock section is also broken down by
**cluster-territories** («Москва», «Самара», «Екатеринбург»…): the report CSV carries a `WAREHOUSE`
column, the parser accumulates per-warehouse totals in the same loop as the global ones (sums match
by construction), and `fby/fby-clusters.ts` — a leaf registry, the `brands.ts` pattern, because the
API has no cluster concept — folds warehouses by name markers at render time. A warehouse unknown to
the registry prints under **its own name** rather than a «прочие» bucket, so a new Yandex site stays
visible with no code change. **The FBY summary always ships an xlsx** (`fby/fby-workbook.ts`, three
sheets: per-warehouse totals, the flat SKU×warehouse table straight from the report, and the problem
list) — always rather than "when it did not fit", because the positions table is thousands of rows and
fits in no message at any threshold, while a file-on-condition would leave the seller guessing why
there is none this time. Rows that are zero across all types are dropped: they say nothing and on ten
warehouses would inflate the file several times over. The message itself now goes through
`splitMessage` — problems, requests and clusters together outgrow 4096 characters, and Telegram
answers 400, i.e. the screen would not arrive at all rather than arrive in two parts. The chain below
is the **dead** price-changing flow;
nothing reachable enqueues its job types. Price changing has stopped; `FileProcessingProcessor` is out
of `providers` (it would share the `file-processing` queue with `SYNC_STOCKS`, see above), while
`YandexApiProcessor` and `NotificationsProcessor` are still registered on their own `yandex-api` /
`notifications` queues but receive nothing — the only entry, `handlers/file-upload.handler.ts`, is not
imported at all. User-facing texts in the dead
files (price coefficient, CSV, «Скачать пример») read like live copy — do not edit their wording, they
go away together with the code.

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

### The one broadcast: «не забудьте оплатить хостинг» on the last day of the month

> No longer the only one: seller notifications (TASK-152) are a second, per-seller digest — see
> `src/modules/notifications/README.md`. This section stays about the hosting reminder.

Every other message the bot sends answers something a seller did. This one does not: on the **last
day of each month at 10:00 MSK** it writes to every approved seller with a connected store. Hosting
is paid monthly and nobody remembers.

- **Cron cannot say "last day of the month"** — `L` in day-of-month is not something Bull's
  `cron-parser` guarantees, and 28/29/30/31 depends on the year. So the repeatable job fires on
  `0 10 28-31 * *` and `isLastDayOfMonth` (pure, in `moscow-day.ts`, via the existing `shiftDays`)
  decides. Three wake-ups out of four end in nothing — that is the normal case and logs at `debug`,
  not `warn`. A daily cron would mean 27 idle wake-ups a month and the very same check in code.
- **Its own scheduler** (`queue/services/hosting-reminder.scheduler.ts`), not a branch in
  `ReportSchedulerService`: that one reconciles **per-seller** schedules against Mongo — as many jobs
  as documents. Here there is exactly one job and nothing in Mongo corresponds to it. The `jobId` is
  a **constant** for the reason `ReportSchedulerService.jobId` is derived rather than random: a fresh
  id per boot would mean a second job and two identical reminders. On bootstrap a job with that id
  but a **different** cron is removed (otherwise changing the time in code leaves both); an identical
  one is left alone, because Bull mints a tick's id from the repeat key plus the tick time, so
  re-adding the same job creates no duplicate.
- **It walks `BotRegistry.all()`, not `first()`** — with two tenants the reminder would silently
  reach the sellers of only one of them. `all()` was added for this.
- **Recipients are picked by a pure function** (`price-changer-bot/hosting-reminder.ts`, which also
  holds the single copy of the text): `approved` **and** in the set of connected stores **and** the
  `hosting_reminder` feature open. Stores are resolved in **one** `$in` query
  (`findByTelegramUsers`), the `AccessController` trick, never `isConfigured` per row. A record with
  no `telegramChatId` is skipped silently — `sendMessage` would answer 400 and the throw would cost
  the reminder to everyone further down the list.
- **`hosting_reminder` is the first feature to ship `defaultEnabled: true` in a long while.** The last
  ten were introduced off because they were unproven and cost Partner API requests; this one makes no
  outbound calls and is meant for everybody — the flag exists to close it for a seller who settled
  payment some other way. Like `PROMOTION` and `DEEP_HISTORY` it has **no `MENU` key**: there is no
  screen and no update, so `featureGate` never sees it and the **processor** reads the flag itself.
- **A failure on one recipient does not stop the rest** (403 «blocked the bot» is the common case and
  not a fault — the `AccessNotifierService` argument), and those are not reported to `ErrorReporter`:
  a failed `callApi` is already journalled by the outgoing funnel, and an admin alert per blocked
  seller would make alerts unreadable. Sends are sequential with a 100 ms gap — Telegram allows ~30
  messages/second and this is the only place the bot writes to dozens of people in a row.
- **No second `@OnQueueFailed`** on the `reports` queue — `ReportsProcessor` owns that hook.
- **The panel has its own card for it, because the «Рассылки» table structurally cannot show it.**
  `QueuesService.digests()` parses repeatable-job ids as `report-<botId>-<userId>-<reportKey>`
  (`parseReportJobId`; `report:<botId>:<userId>:<reportKey>` before TASK-157) and
  **silently skips** everything else — so the reminder was invisible in the panel from the day it
  shipped, and «did it go out?» had no answer short of grepping the journal. A row there would not
  fit either: that table's columns are «кто» and «какой отчёт», and this broadcast has many
  recipients and no report. Hence `GET /api/queues/hosting-reminder` and a card on «Очереди»
  showing four things: **whether the job is registered at all** (absent ⇒ the deployed build
  predates the feature — the single most useful diagnosis), the next send, who it will reach, and
  when it last ran.
  - **Recipients come from `HostingReminderService`, shared with the processor.** A second copy of
    the selection rule would let the panel show one list while the bot writes to another — the
    same drift the help screens paid for. The rule itself stays in the pure `pickRecipients`.
  - **The run leaves one journal row** (`ActionLogService.record`, `kind: 'hosting-reminder'`,
    `telegramUserId: 'system'`) — the `kind: 'health'` precedent. The outgoing funnel already
    journals each message («кому ушло»); this row answers a different question («рассылка
    состоялась»), and it is what the card reads as "last send". «Получателей нет» is recorded too:
    silence is not an answer to «почему никому не пришло». Nothing is written on the three idle
    wake-ups — they would bury the real rows.
  - **«Отправить сейчас» enqueues the same job with `force: true`**, which skips the last-day check
    and **only** that — the recipient selection stays shared, so the button cannot write to a
    seller whose flag is closed. No `jobId` and no `repeat` on that job: two clicks mean two
    broadcasts, and hiding that behind dedup would make a repeat click silently do nothing;
    the confirmation dialog is what guards it. A test pins both.
  - `cronToTime` now parses only minutes and hours, ignoring the last three fields: with the old
    "three asterisks" pattern the card printed a raw cron instead of «10:00 МСК», because this job
    has a day-of-month range. When it fires is explained by the screen, not by that helper.
- **`scripts/preview-hosting-reminder.ts` is how you check it without waiting a month**: read-only,
  no Nest at all (raw mongoose, like the `diagnose-*` scripts — booting `AppModule` would start
  `BotRegistry`, which re-points the webhook away from the running bot). It prints the text, the next
  send date and every access record with the one reason it will or will not receive the message.

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
    revision of the docs claimed `ctx.reply` rode the singleton funnel; against telegraf 4.16.3 that
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
- The only outgoing path outside telegraf is `TelegramApiService` (raw `fetch`), and it is used
  solely by the **dead** notifications processor (registered, but nothing enqueues its jobs) — the scheduled digest goes through
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
  unused (earlier revisions of the docs listed it as dead template weight).
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
- **Nothing a blocked user can see is a button.** Two surfaces carry buttons and both are
  cleared, because either one alone leaves the seller looking at controls that answer «подайте
  заявку»:
  - **The reply keyboard is persistent** — it stays on screen until something explicitly removes
    it. The gate does that when it refuses an update, but the gate is not enough: `/start` it
    passes **always**, and «доступ закрыт» is sent from three places that never go through it at
    all. So `Markup.removeKeyboard()` now rides **every** «нет доступа» reply — the two `/start`
    branches (`pending`, `rejected`) and the wizard invitation, the rejection from the admin card,
    the revoke from «👥 Пользователи», the revoke from the panel's toggle, and the three
    application replies in `api-settings.handler`. `__tests__/unit/blocked-no-keyboard.test.ts`
    reads those files as text and fails when one drops it — a forgotten argument breaks neither
    compilation nor any scenario, which is exactly how the whole list ended up missing it.
    - The wizard invitation is therefore **two messages** (Telegram allows one `reply_markup` per
      message): the greeting removes the keyboard, the question carries the wizard's inline
      buttons. Same shape as `replyApproved` for an unconnected store.
  - **The command list («синяя кнопка Меню») is per-chat.** `setupBotCommands` now installs the
    **guest** list — `/start` alone, the only thing `canPass` lets through at any status — as the
    bot's default scope, and `BotCommandsService` sets the full one with
    `scope: {type:'chat'}` on approval, deleting that override on revoke so the chat falls back to
    the guest default. Deleting rather than re-sending a copy: editing the default later must not
    leave chats holding a stale copy of it.
    - **`UserAccess.commandScope` is memory of what was sent, not a second status.** Without it
      every update would have to re-confirm the list through Bot API; with it the steady state
      costs nothing, and already-approved sellers pick the full list up on their next update —
      no migration. The sync sits in `AccessGateHandler.touch()`, the one place every non-admin
      update passes with the access record already in hand, and is `void`-ed: a command list may
      not delay a reply (the action-log policy).
    - The three admin decision paths push immediately instead of waiting for that next update —
      a closed seller may never send one, and their menu would stay full meanwhile.
    - **Admins have no `UserAccess` row**, so there is nowhere to record what was sent: their full
      list goes out from the admin branch of `/start`, deduped by an in-process `Set`. A restart
      re-sends it once; admins are few.
- **The support contact is printed in exactly one screen — `/help`** (and its CRM copy «Помощь», built
  from the same `help.text.ts` model; the CRM admits only approved sellers). That is a screen a
  non-approved user cannot reach (the gate classifies `/help` and «❓ Помощь» as `command`/`menu`
  and `canPass` closes both), which is the point: `SUPPORT_CONTACT` is the owner's personal
  Telegram nick. It used to sit in «⚠️ Не удалось отправить заявку администратору» too — the one
  support-mentioning screen a **new** user does see, and it fires on the common case of an admin
  who never pressed `/start`. The same test pins that only `help.text.ts` reads the constant.

> The previous subscription system is **gone** (TASK-036) — it granted every new user a free week,
> its plan buttons charged nothing, and its only check sat in `/start`, so uploads bypassed it.
> `__tests__/unit/subscription-removed.test.ts` fails if the concept creeps back.

### Per-feature access: approval says _whether_, flags say _what_

> **Every new function ships behind its own feature** (owner, 2026-10-14, decision
> `new_functions_behind_feature`): a new CRM section, bot screen/button, report, broadcast or
> action gets its own key here with `defaultEnabled: false` until the owner opens it, gated by
> `featureGate` / `@RequireFeature` and listed in `crm-parity`. A function that calls the AI module
> needs **two** keys — its own and `ai` — and is hidden and refused when `ai` is closed, before
> `AiService` is ever reached — declare `requires: [FEATURE.AI]` (TASK-153, see below). `AiService` stays the last barrier,
> not the only one. A restyling of existing functions is not a new function and gets no key.

`UserAccess.status` is boolean — all or nothing. On top of it sits a registry of 50 features
(`src/modules/telegram/bots/shared/features.domain.ts`), each switchable **per user** from the admin
panel. This is not a second access system: `canPass(status, kind)` still answers "may this person
use the bot", `requiredFeatures(update)` answers "which function is being invoked". Merging the two
tables would mean a change to access rules silently reshapes the feature set, and the reverse.

The six report keys (`report_shipped_today` … `report_profit`, one per report button) are
**literally the values of `REPORT`** — a second taxonomy for the same six
things would drift, and the digest already keys its schedules by them (`tariff_calc` is both the
sixth report key and its feature key, same string). Plus `schedule` (раздел «⏰ Рассылка» и
дайджест), the two
price-list halves `purchase_prices` / `stock_update`, `promotion` (the promo-commission editor
«📣 Продвижение» on the settings screen — per brand, a flat percent or two price tiers, and on top of either an optional
**нижний порог** `from`: the price from which promotion is charged at all, cheaper items give 0 %,
the boundary inclusive like the tier's `limit`.
It is **question 1 of 2** («💯 Общий процент») and **1 of 4** («🪜 Зависит от цены»), not a button of
its own: behind a button that only appeared once a percent existed, the seller walked the whole
setup and never learned the floor was there — that shipped and was rejected within the release, and
`promo:floor:<brand>` survives only as a legacy action reopening the mode screen. `0` answers «порога
нет» and is **never stored** (`promoWithFloor` omits the key, and `promoConfigsOf` treats a stored
`from: 0` as junk). Intermediate answers ride the single `UserAccess.pendingRate` string
(`promo:<key>:<step>:<F>[:<X>[:<A>]]`, table in `promo.ts`) with **one `$set` at the very end**; the
pre-floor forms, one segment shorter, are still read — as `from: 0` — so a question open across the
deploy resolves instead of dangling in Mongo. Step numbering comes from `promoStepTitle`, never from
literals beside the text. A junk `from` in Mongo drops the whole entry rather than being ignored —
silently charging promo where the seller declared none would understate profit invisibly), and the
two FBY-only screens
`warehouses` / `fby`; the rest of the registry (Partner API screens, CRM sections, finance, AI,
Ozon/WB) is described in `FEATURE_META` and the READMEs of those modules. `/start`, «🏠 Главное
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
  be opened one seller at a time — `warehouses` and `fby` were the first to do that, and 35 of the 45
  keys ship off now; ten are `true` (the five order-report keys, `schedule`, `purchase_prices`,
  `stock_update`, `promotion`, `hosting_reminder`).
- **Dependencies are `FEATURE_META[key].requires`, folded into `isFeatureEnabled` itself** (TASK-153).
  A feature is open only when its own flag **and** every dependency (transitively) is open;
  `isFeatureOpen` adds the FBY placement check for the dependencies too. Folding it into the lowest
  function, not only into `isFeatureOpen`, is the point: about twenty call sites read a flag directly
  (CRM kinds, bot handlers, processors), and `resolveFeatures` is the `features` snapshot CRM carries
  in the JWT user and `/auth/me` — every one of them would otherwise have to remember the dependency,
  which is exactly how «Unit-экономика» stayed visible with «Финансы» closed and led into a 403. A
  resolved snapshot resolves to itself, so double resolution is harmless. Admins pass through
  `allFeaturesEnabled()` (all true ⇒ dependencies open). Today `unit_economics`,
  `sales_analytics`, `sku_ratings`, `forecast`, `marketplace_compare`, `inventory`, `finance_anomalies`,
  `finance_upload` and `profit_actual` require `finance`, `tax_year` requires `taxes` **and** `finance`,
  `ai_analyst` and `ai_period_review` require `ai` **and** `finance`, `feedback_ai_reply` requires
  `goods_feedback` **and** `ai` (its bot button is `fb:ai:<id>`, gated for both), `stock_push_write_ym` requires
  `stock_push`, `stock_push_write_ozon`/`stock_push_write_wb` require `stock_push` **and** `ozon`/`wb`, `stock_push_schedule` requires `stock_push`; `overview` and `price_calculator` do **not** — they depend on
  it only partly and work without it. The graph is checked by `featureGraphProblems` in a test
  (unknown key, self-dependency, cycle) — `enabledIn` recursion on a cycle would overflow the stack.
  - **The panel toggles the own flag, not the effective value.** User rows carry both `features`
    (`resolveFeatureFlags`, what the toggle writes) and `effectiveFeatures` (`resolveFeatures`, what
    the seller gets); bound to the effective one, the toggle would not move after a click while the
    dependency is closed. The card prints «Требует: …» and «Не действует, пока закрыто: …».
  - Explicit pairs written before the rule (`@RequireFeature(FINANCE, FINANCE_ANOMALIES)`, the unit
    economics kind's `[unit_economics, finance]`) are now redundant but left alone — harmless.
- **`FEATURE_KEYS` is built from a `Record<TFeatureKey, true>`**, for the `DRAFT_FIELD_SET` reason —
  an array literal does not force the union to be complete, and TASK-052 already paid for that.
  The key lands in a `$set` path (`features.<key>`) and arrives over HTTP, so `setFeature` whitelists
  it exactly as `saveDraftField` does.
- **`featureGate` is one `bot.use`, not a check per handler** — same argument as `accessGate`: a
  check registered in the pipeline cannot be forgotten in a new handler, because the new handler is
  registered after it. It **returns before touching Mongo** when the update maps to no feature, which
  is most updates (free text, onboarding, settings, help). It reads `UserAccess` itself rather than
  receiving it from `accessGate`: `ctx.state` was used nowhere in the repo at the time, and introducing the
  convention for one field costs more than a read on the updates that actually reached a report.
  (Since then the gates put `markRefused` into `ctx.state` for the metrics — see «📈 Метрики Telegram
  API» above and `src/modules/metrics/README.md`, «Metrics».)
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
- **Editing is web-panel only** (раздел «Пользователи» → карточка продавца, тумблеры; в Telegram
  кнопок для возможностей нет), whole controller behind `AdminJwtGuard`:
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
  `access-decision.text.ts`, shared with both Telegram entry points (the application card and
  «👥 Пользователи») and pinned by
  `access-decision-text.test.ts` — three copies of "Доступ открыт!" would drift exactly as the help
  screens once did, and the seller would read different explanations of one event depending on
  where the admin pressed. Revocation and application-rejection are **different** texts: a seller who was
  working has no pending application, and «Заявка отклонена» would answer something they never sent.

### Error handling

`telegraf.catch()` in `BotRegistry` reports the error through `ErrorReporter` (`source: 'bot'`,
`context: 'telegraf'`) and replies «Произошла ошибка. Попробуйте позже.» to the user.

`src/shared/decorators/TryCatch.ts` + `DecorateWith.ts` are the **pre-Nest** approach:
`@DecorateMethodsWith(TryCatch())` wrapped every own-prototype method in `try/catch → console.error`,
**swallowing the error and returning `undefined`**. It is `@deprecated` and applied to nothing
(TASK-013) — kept as a monument, because it produced errors that surfaced as `TypeError` far from
their cause. Do not reapply it.

Nest's `LoggerInterceptor` (`src/common/interceptors/logger.interceptor.ts`) and the global
`AllExceptionsFilter` (`src/common/filters/all-exceptions.filter.ts`) cover HTTP; the rest of error
catching is in `src/modules/errors/README.md`, «Error catching». Logging in newer code is Nest
`Logger`; older handlers still use `console.*`.
