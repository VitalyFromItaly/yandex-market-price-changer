# Метрики (страница «Метрики» админки)

## Доводы и история решений

> Перенесено дословно из корневого `CLAUDE.md` (2026-10-18), чтобы он не грузил в каждую
> сессию то, что нужно только при работе в этом модуле. Здесь и правила, и почему они такие.

### Metrics: the «Метрики» page (`src/modules/metrics/`, `web/admin/src/pages/MetricsPage.vue`)

Three blocks behind `GET /api/metrics?range=24h|7d` (`AdminJwtGuard` on the whole controller):
Telegram API answers, latency of external services, and the bot's own work. In the admin panel, not
Prometheus: that means more containers on a host whose disk has already run out once.

- **Bot API calls are counted in the existing `callApi` funnel** (`BotRegistry.installOutgoingLog`),
  for **every** method, not only `OUTGOING_METHODS`. A dead mirror shows up first on `getUpdates`
  and `getMe`, and the outgoing journal records neither.
- **Counted as per-minute buckets, never one row per call.** Under polling `getUpdates` never
  stops, so a row per call would turn the collection into a `getUpdates` feed.
  `TelegramApiMetrics` (`telegram/bots/telegram-api-metrics.service.ts`) accumulates
  `(minute, bot, method, outcome)` in memory and flushes once a minute with `$inc` into
  `TelegramApiBucket` (TTL 30 days).
  - It runs on `setInterval`, not Bull, for the `HealthMonitorService` reason.
  - A failed flush **drops** the batch rather than holding it: the database may stay down for
    hours, and the self-check is already reporting it. The lost minutes appear as a gap.
  - A final flush runs in `OnApplicationShutdown`. `observe` is synchronous and never throws.
- **`lat` is a histogram, and in Mongo it is an object.** Window percentiles are taken from summed
  histograms; averages of averages would be wrong. The fields are `$inc`'d by path `lat.<i>`, which
  makes an object on a fresh document. So the prop is `Mixed` with **no default**: a default `[]`
  would become `$setOnInsert`, which conflicts with those paths. `latArray` converts it back on
  read.
- **The percentile is the bucket's upper bound** (`histogramPercentile`, never above the observed
  max), so it means "p95 ≤ 750 ms". Interpolating would print precision the data does not have.
- **`getUpdates` is excluded from latency** (`LONG_POLL_METHODS`) but still counts as calls and
  errors. It is a long poll, so its duration is a timeout we chose. Including it makes the API p95
  "50 s".
- **Outcome is `ok`, the Telegram `error_code` as a string, or `network`** (no answer at all).
  `network` is the mirror-death signal: Telegram only returns a code when the request reached it.
- **Telegram failures now carry their details** (`telegramErrorInfo`, duck-typed against telegraf's
  `response`):
  - `httpStatus` is the code and `errorType` is `TelegramError:<code>`. telegraf sets no `name`, so
    this used to be a bare `Error`, and 429 hid behind 403 in the alert throttle.
  - `retry_after` is appended to the message.
  - The journal row is `direction: 'out'` with `durationMs`.
  - **403 and 400 no longer page admins** (`shouldAlertTelegramError`): "blocked the bot" is client
    behaviour, the same "4xx does not alert" rule as HTTP. 429, 5xx and `network` still alert. The
    row is written either way.
- **Mirror latency comes from the self-check, not from traffic.**
  - `checkTelegram`, `checkYandex`, `checkRedis`, `checkPostgres` and `checkPolza` measure `latencyMs`.
  - Every pass writes one `HealthSample` per check (TTL 30 days), fire-and-forget through a
    `record` that never throws. The monitor must still work with Mongo down.
  - The summary, `/health` and the daily digest print `· 240 мс` (`latencySuffix`).
  - getMe takes the path every seller reply takes, so its trend is the "mirror is degrading"
    warning that arrives before the outage alert.
- **Bot work is read from the existing `actionlogs`**, plus one new field, `refusedBy`
  (`access` | `feature`).
  - The gates put it in `ctx.state` (`markRefused`). `ActionLogHandler` sits before them and writes
    it into the same row after `await next()`.
  - This is the first use of `ctx.state` in the repo. The alternative was the gate writing its own
    row, which means two rows per update.
  - `findUpdatesSince` takes an **allow-list** of kinds (`ACTION_KINDS`, built from a `Record`).
    Health, CRM, reminder and error rows are also `direction: 'in'`, and a deny-list would let the
    next service-row kind leak into "updates per hour".
  - New index `{direction: 1, createdAt: -1}` (`npm run db:sync-indexes`).
- **Percentiles are computed in JS** (`metrics.domain.ts`, a leaf with zero imports, unit-tested).
  `$percentile` needs Mongo 7.0 and the prod version is not pinned. A week is thousands of rows
  read with a projection.
- The page charts with its own inline-SVG `SparkBars`. There is no chart library in `web/admin/`, and a
  CDN is unreachable from prod. A `null` column ("no samples") is drawn as a dashed line so it does
  not read as zero.
- The overview adds one line: calls, errors, p95 and current mirror latency for the day. It is
  fetched **outside** the `Promise.all`, so a metrics failure cannot break the screen people open
  for pending applications.
