# Самопроверки (`HealthMonitorService`)

## Доводы и история решений

> Перенесено дословно из корневого `CLAUDE.md` (2026-10-18), чтобы он не грузил в каждую
> сессию то, что нужно только при работе в этом модуле. Здесь и правила, и почему они такие.

### Self-checks: the bot reports its own outages

`ErrorReporter` only fires when something already broke **under a user**. On 05-08-2026 the host ran
out of disk, Mongo went into a `WT_PANIC` crash-loop and the deploy stopped building — and the first
report came from a seller, because at night nobody presses a button and `telegraf.catch` never runs.
`HealthMonitorService` (`src/modules/health/`) closes that: every `CHECK_INTERVAL_MS` (5 min) it
looks at **six** things — free disk space, Mongo, Postgres (finance, since TASK-156), Redis, the
Telegram Bot API and the Yandex Market API — plus a **seventh**, the Polza.ai balance, when AI is on —
and messages the admins itself. The message goes out **the moment a problem is found** and is
not repeated until the state changes.

- **Disk is the point of the whole thing.** It fills up gradually, so the warning arrives _long
  before_ the database dies and the image stops building — the other two checks only confirm an
  outage already under way. `statfs('/')` is read from inside the container: the rootfs sits on the
  same partition as `/var/lib/docker`, so the host filling up is visible. `bavail`, not `bfree` —
  part of the blocks is reserved for root and an ordinary process stops writing before `bfree`
  reaches zero. Thresholds are **ratios**, not gigabytes (`0.15` warn / `0.07` down): an absolute
  figure would need fitting to one server and would silently rot on the next tariff change.
- **`setInterval`, not a Bull repeatable job** — the mechanism the daily digest uses. A repeatable
  job lives in Redis, so a Redis outage means it simply does not run, i.e. that exact failure could
  never be detected. The monitor has to work when everything else is broken, so it depends on
  neither Mongo nor Redis. `clearInterval` in `OnApplicationShutdown` for the same reason
  `BotRegistry` stops polling there: a live timer keeps the event loop and a container that got
  SIGTERM never exits. The first run is delayed `FIRST_CHECK_DELAY_MS` (30 s) — connections are not
  up instantly, and without it every start would report an outage that isn't there.
- **The two external APIs are checked differently, and both choices are load-bearing.**
  - **Telegram goes through `getMe()` on an already registered bot** (`BotRegistry.first()`), not
    through a request of our own: that exercises the exact path every reply to a seller takes,
    **including the `TELEGRAM_API_URL` mirror**. Prod sits in Russia where `api.telegram.org` is
    unreachable directly, so a dead mirror is precisely the class of outage this exists for. `getMe`
    is not in `OUTGOING_METHODS`, so it does not pollute the outgoing journal. A bad token answers
    401 and counts as down too — different cause, same consequence: the bot is mute. **The circular
    problem is admitted rather than hidden:** when it is Telegram that is down, there is nothing to
    send the alert with; the console line and the journal row remain, and «снова в норме» arrives
    once the link is back.
  - **Yandex is probed with no `Api-Key` at all, and 401/403 counts as success.** What is being
    tested is reachability, not authorisation: Partner API keys are per-seller, and burning
    somebody's quota every five minutes for a self-check is not acceptable. Any HTTP answer proves
    DNS, network and the service are alive; a timeout or a network error proves they are not. This
    is the one hand-built Yandex URL in `src` and it is deliberate — `YandexApiClient` (from
    `YandexClientFactory`) is built around a specific seller's key, and here there is no key by design.
  - **One network failure is not an outage: the Yandex probe retries once after 3 s.** On
    13-10-2026 a single `ETIMEDOUT` while connecting raised «API Яндекс.Маркета: авария». The next
    request a second later succeeded, and so did the next check. Only two failures in a row count
    as `down`. A success on the second try is still recorded in the detail line (`со второй
попытки (первая: …)`).
  - **The probe waits 10 s (`YANDEX_PROBE_TIMEOUT_MS`), not `PING_TIMEOUT_MS`.** `ETIMEDOUT` with a
    list of addresses is **not** our timeout firing. Ours reads «нет ответа: …». That error comes from
    Node's happy eyeballs, which gives each address `setDefaultAutoSelectFamilyAttemptTimeout` before
    moving on. The default is 250 ms. `main.ts` raised it to 2 s on 25-09-2026 and to 5 s on
    14-10-2026, after IPv4 `93.158.134.216` still timed out. The 10 s probe fits one slow IPv4 attempt
    plus the IPv6 fallback. Raising only our timeout would change nothing, because the connection
    is cut per address first.
  - **The alert names the cause and the scope.** Node's `fetch` always says «fetch failed» and
    keeps the reason in `cause`. With IPv4/IPv6 fallback the reason is in `cause.errors`, an
    AggregateError. `networkErrorDetail` (`health.domain.ts`) turns that into the code in Russian
    plus the addresses tried, for every network check. The Yandex alert also says that the probe
    tests the whole host, not one method. It compares with Telegram from the same pass: Telegram
    up means the problem is on the way to Market, Telegram down means the server's own network.
    Failures of individual methods arrive as their own alerts with «Запрос: …».
- **The Polza balance is the second "runs out gradually" check, after the disk** (TASK-105). The key is
  shared and the owner pays, so empty money or a revoked key would otherwise be found by a seller
  pressing an AI button and getting a 402.
  - **Registered only when `polzaAiEnabled`.** No key means AI is off by design, not an outage: no
    summary line, no `HealthSample`, and the «Метрики» card is hidden while the window has no Polza
    samples (`OPTIONAL_PROBE_KEYS`) — an empty «нет данных» card would read as a broken check.
  - **Through `AiService.balance()`, not `PolzaClient`.** The client stays unexported (the one-door
    rule). `balance()` is a system call: no seller, no feature, no daily limit, **no `AiUsage` row**
    (`GET /v2/balance` is free and belongs to nobody), and it does **not** report errors — the
    monitor judges them and records with `alert: false`. Reporting there too would mean a second row
    and an alert outside `shouldNotify` every five minutes.
  - **The threshold is roubles, not a ratio** (`POLZA_AI_BALANCE_WARN_RUB`, default 200 ₽, owner's
    decision `polza_balance_warn_default`): a balance has no "total" to divide by. `available ≤ 0` or
    an unreadable number is `down` whatever the threshold — every request will get 402; `0` turns
    only the warning off. Pure `polzaBalanceStateOf` in `health.domain.ts`.
  - **401 and 402 are `down` with their own reason** («ключ отозван», «нет средств»): different
    causes, one consequence — AI is dead for everybody. The alert carries `POLZA_SCOPE_NOTE` (all
    sellers) plus a **cause-specific** `hint`: `POLZA_ACCOUNT_HINT` («пополнить/проверить ключ») for
    low balance/401/402, `POLZA_NETWORK_HINT` for timeout/network/429/502/503. On 14-10-2026 two
    timeouts arrived with «пополнить баланс», which sent the admin to the wrong place.
  - **The probe calls `balance({signal, retry: false})`.** Without its own retries a 503 reaches the
    monitor as `HTTP 503 …` instead of hiding behind «нет ответа за 10000 мс» (1+2+4 s of client
    backoff do not fit in 10 s), and the `AbortController` cancels the abandoned request — a bare
    race left it hanging up to 620 s, two sockets per check.
  - **10 s race, not `PING_TIMEOUT_MS`.** Polza answered a single request in 68 s once, so 5 s is
    too tight; and the race stays as a backstop beside the abort, because the client's own timeout
    is 620 s, sized for a model answer.
  - **One retry after a network failure, timeout, 429/408/502/503; none after 401/402 or 400/500**
    (answers, not hiccups) — the Yandex rule, and for
    the same kind of evidence: on 14-10-2026 the first live balance request took **68 s**, the next
    three 0.3–0.4 s (curl 1.2 s). Without the retry that is an «авария» and a «снова в норме» five
    minutes later. 401/402 are answers, not hiccups; repeating them changes nothing.
- **Mongo is checked by `connection.readyState`, deliberately not by a ping.**
  `serverSelectionTimeoutMS` is 30 s, so a ping would hang each check for half a minute exactly
  during the outage — the moment the monitor exists for. Redis _is_ pinged (`queue.client.ping()`,
  ioredis under Bull) but inside a `Promise.race` with `PING_TIMEOUT_MS`: ioredis has its own
  retries and without the race the call may never return at all. Postgres is pinged the same way
  (`SELECT 1` in a race with `PING_TIMEOUT_MS`): the pool is lazy and has no "connected" flag, and it
  waits up to its own 10 s for a connection. A dead Postgres hits only finance.
- **Alerts go out on a state _change_, plus one reminder per hour while it lasts** — `shouldNotify`
  in `health.domain.ts`. Sending on every check would be 288 identical messages per day of outage,
  after which alerts stop being read; that is the `AlertThrottle` argument again. And **that
  throttle is bypassed on purpose**: its window is 15 min per `errorType + context`, so a
  `warn → down` transition five minutes after the warning — the single most important alert — would
  be swallowed. Problems are recorded with `report({alert: false})` (so the outage is still visible
  in the panel) and sent through the new `ErrorReporter.notifyAdmins`, which has no throttle of its
  own precisely because timing is the caller's decision here.
- **Silence needed a meaning, so there are three ways to see "all fine".** Alerts only fire on
  change, which is right — but then "no outages" and "notifications are broken" look identical, and
  the difference would surface exactly when a message fails to arrive. Hence: **`/health`**
  (`health-command.handler.ts`, admins only, silent for everyone else and absent from
  `setMyCommands` — the `/users` argument), a **summary on startup**, and a **daily summary** at
  `DAILY_SUMMARY_AT` (09:00 MSK). All three render through one `summaryText` — three copies of one
  screen is the drift the help screens already paid for. The startup message counts as that day's
  summary, or a container brought up in the afternoon would send two identical messages in a row;
  as a side effect it also surfaces unplanned restarts. `/health` reads `HealthMonitorService.collect()`
  rather than computing its own view: the admin must see exactly what the monitor decides on.
- **Recovery gets its own message _and_ its own journal row.** Silence after an alert is
  indistinguishable from "the monitor died too", which sends the admin to check by hand — the very
  thing the monitor was written to avoid. The row goes through `ActionLogService.record` with
  `kind: 'health'`, **not** through `report`: a recovery is not an error and has no business in the
  panel's error counter, while the shared `context` (`health:<key>`) puts it next to the outage it
  ended. Its `error` field stays empty for the same reason — filling it would lie to the "show me
  only what broke" filter.
- **The console only prints "ok" once an hour** (`LOG_OK_INTERVAL_MS`), plus whenever a check
  returns to normal; problems print **every** cycle. Six or seven checks every five minutes is
  ~1700–2000 lines a day, and `docker logs` then becomes a feed you have to search an outage in — which is exactly the
  state the journal was built to escape. Alerts are unaffected: they are governed by `shouldNotify`,
  not by the log.
- `health.domain.ts` is a **leaf module with zero imports** (the `telegram-html.ts` pattern) and
  returns text with **no markup**: `notifyAdmins` escapes, because an ioredis or mongoose message
  easily contains `<`. `now` is a parameter, not `Date.now()`, so `shouldNotify` is testable without
  timers — same as `LoginThrottle`.
- `HealthModule` imports `DatabaseModule` (for the connection), `PostgresModule` (for the pool),
  `AiModule` (for `AiService.balance()`) and `forwardRef(() => TelegramModule)` for the `reports` queue
  and `BotRegistry`. A local `BullModule.registerQueue` is **forbidden** for the reason
  `QueuesModule` already records: second Redis connections and a second place holding queue options.

**`lazyConnection: true` on `MongooseModule.forRootAsync` is what makes any of the above possible
with the database down.** By default `@nestjs/mongoose` calls `connection.asPromise()` inside module
initialisation and retries it ten times, so an unreachable Mongo means the app **never boots at
all** — no bot, no monitor, no alerts, silence instead of a shout. That single default is what made
the `BotRegistry` fallback below dead code, and it was found by booting the image against a dead
address, not by reading. Queries issued before the connection is up are buffered by mongoose and
fail on `bufferTimeoutMS` (10 s) — faster than the 30 s server selection — so `loadOrSeedBots`
reaches its `catch` and raises the bot from configuration. Reconnection is mongoose's own job.
Verified both ways: with Mongo dead the log shows «База недоступна — поднимаю бота из
TELEGRAM_TOKEN» after 10 s; with Mongo alive the normal branch runs and the fallback never fires.

**`BotRegistry` now starts even with Mongo down** (`loadOrSeedBots` catches the read and falls back
to a bot built from `AppConfigService.telegramToken`, id `no-database`, **not written to Mongo**).
Without it an unreachable database killed the whole bootstrap: no bot registered, so
`ErrorAlertBridge.anyBot()` returned null and the app lost its voice exactly when it had to speak.
The 05-08-2026 alerts arrived only because the container happened not to restart — one redeploy
would have made the monitoring mute. Such a bot can **only shout**: any seller update still hits
`accessGate` reading `UserAccess` and gets «Произошла ошибка». There is no re-read of the `Bot`
collection once Mongo returns — that takes a restart, and the monitor's «MongoDB снова в норме» is
what tells a human to do it. The fallback triggers on a **read error**, never on an empty
collection: seeding from `TELEGRAM_TOKEN` stays the branch it always was.

**What this still does not cover:** a build that fails so the app never starts — the bot lives in
that same container. Partly mitigated by the disk check, which warns long before the image stops
building; full coverage needs external uptime monitoring.
