# Ловля ошибок (`ErrorReporter`)

## Доводы и история решений

> Перенесено дословно из корневого `CLAUDE.md` (2026-10-18), чтобы он не грузил в каждую
> сессию то, что нужно только при работе в этом модуле. Здесь и правила, и почему они такие.

### Error catching

Every error goes through **one** service — `ErrorReporter`
(`src/modules/errors/error-reporter.service.ts`, in a `@Global` module) — and lands in the same
`actionlogs` collection as ordinary actions, with `status: 'error'` and `kind: 'error'`. One
collection rather than two on purpose: the question is always "what was the user doing when it
broke", and the answer is the neighbouring rows of one timeline, not a manual join of two lists by
timestamp. Extra fields: `source`, `errorType`, `stack`, `httpStatus`, `requestUrl`, `context`, and
`details` (Mixed, unindexed — e.g. what Market said about a failed report, `ReportGenerationError`).

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
- **Every HTTP error records the client `ip` and `userAgent`.** The UA is cut to 300 characters.
  - `main.ts` sets `trust proxy` to `1`. There is one hop in front, the CapRover nginx; without it,
    `req.ip` would be nginx's own address. `true` is not used: it would take the leftmost address,
    which the client writes itself.
  - On a direct hit to the port, `X-Forwarded-For` can still be spoofed. That is tolerable because
    the IP only goes into the journal and never decides access.
  - «Мусор» shows a per-IP summary built by `GET /api/logs/junk-sources` → `summarizeJunk` in
    `logs/junk.domain.ts`. It is a pure function because the in-memory test model has no
    `aggregate`; the window is capped at 20 000 rows.
- **No IP blocking in the app — on purpose.** The summary exists to decide whether blocking at the
  edge is worth it at all.
  - Scanners rotate cloud addresses.
  - By the time a request reaches Nest, it has already cost more than the 404 answer.
  - The industry cuts this traffic before the app: nginx `deny` / `limit_req`, fail2ban, CrowdSec
    with shared blocklists, Cloudflare WAF. The panel's «Скопировать для nginx deny» button exists
    for that step.
- **Browser icon requests are answered with 204** in `main.ts` (`BROWSER_ICON`). Browsers fetch
  `/favicon.ico` and iOS fetches `/apple-touch-icon*.png` regardless of `<link rel="icon">`. There
  are no such files on purpose: the icon is one SVG, with no binaries in the repo. Without this,
  every visit to the panel from a phone added three 404s to «Мусор».

Wired in: global `AllExceptionsFilter`, the error branch of `LoggerInterceptor` (`tap` with a single
callback never fired on error), `process.on('unhandledRejection'|'uncaughtException')` in `main.ts`,
`@OnQueueFailed`/`@OnQueueError`, the scheduled-digest catch, `telegraf.catch`, failed outgoing
`callApi`, and the handlers that swallow their errors (`reports`, `stock-upload`) plus the silent
degradation in `ProfitService` (returns unavailable → profit is reported _too high_ with no hint in
the text).

**Known gap:** a request malformed at the HTTP level — raw non-ASCII in the query string — is
rejected by Express _before_ Nest, so no filter sees it and nothing is journalled. A properly
percent-encoded request with the same bad value is caught normally.
