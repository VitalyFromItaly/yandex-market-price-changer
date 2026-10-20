# Админ-панель (`web/admin/`)

Vue 3 + Vite SPA, раздаётся самим Nest из `web/admin/dist`.

## Доводы и история решений

> Перенесено дословно из корневого `CLAUDE.md` (2026-10-18), чтобы он не грузил в каждую
> сессию то, что нужно только при работе в этом модуле. Здесь и правила, и почему они такие.

### The admin panel is served by Nest itself

`web/admin/` is a Vue 3 + Vite SPA; `npm run build` is `nest build && vite build`, and
`main.ts` does `useStaticAssets(join(__dirname, '..', 'web', 'admin', 'dist'))` — one repo, one image, one
container. The path resolves correctly both in prod (`/app/dist` → `/app/web/admin/dist`) and under
ts-node in dev (`src/` → `web/admin/dist`).

- **Vite build, not Vue from a CDN.** Prod is on a Russian host where external domains are as
  unreachable as `api.telegram.org` — a CDN-loaded panel would work on the developer's machine and be
  a blank page in production.
- Static files are served by express middleware **before** the Nest router, so `LoggerInterceptor`
  never fires for them and the log is not flooded with one line per asset.
- The global `/api` prefix is what leaves `/` free for the panel. There are several screens — an
  overview, the user list, one seller's card, the log (and its «Мусор» view), metrics, AI and queues —
  so there **is** a `vue-router`, but on
  **`createWebHashHistory`**. With normal history a refresh on `/users/999/222` would go to the
  server, which has neither that file nor that route, so F5 on a seller's card would 404. That is
  fixable with an SPA fallback in the static handler, but the fallback would have to carve out
  `/api` — and any slip in it turns an API error into a silently served `index.html`. The hash never
  reaches the server: address, back button and reload all work with no backend change at all.
  Pages live in `web/admin/src/pages/`, each fetching its own data; a shared loader in `App.vue` would mean
  the log screen fetching sellers and the seller card fetching logs.
- **Auth state is module-level `ref`s in `web/admin/src/auth.ts`**, not Pinia — three fields do not justify
  a store, and a module `ref` _is_ the shared instance. It moved out of `App.vue` when routed pages
  stopped receiving props from it.
- The 10 s auto-refresh belongs to the log and queues pages **only**, and each `setInterval` is cleared
  in `onBeforeUnmount`: under the router the component unmounts on navigation, and a live timer would
  keep polling `/api/logs` (or the queues) from another screen.
- **Toggles never hold their own state.** `ToggleSwitch` renders `modelValue` and emits `change`; the
  page replaces its row with whatever `PATCH` returned. A self-toggling switch would confidently
  claim access is closed while it is open, the moment a request fails. Inside it is a real hidden
  `<input type="checkbox">`, not a `<div>` with a click handler — focus, space, screen readers and
  `:disabled` then work for free.
- Labels shared by the list and the card (`STATUS_LABEL`, `displayName`) live in
  `web/admin/src/users.domain.ts`. Two copies would name one state differently on the two screens.
- **The log filters by seller from a dropdown, and the backend was not touched for it.**
  `filterOf` already matches `telegramUserId` exactly and the picker submits exactly that id; a
  `?who=` param with a regex over `username`/`name` would be a second filter — on an unindexed field
  — for what the existing one already does. The options are built by `logUserOptions`
  (`users.domain.ts`) from `/api/access/users` **plus every id present in the loaded rows**, and that
  second half is not decoration: admins have no `UserAccess` row at all and HTTP/process failures are
  recorded under `telegramUserId: 'system'`, so a picker limited to sellers could not select the two
  groups whose entries are most often looked for. Log-derived options are labelled from the row
  itself (`username`/`name` are stored per entry) and shown in their own `<optgroup>`. The selected
  value is always kept as an option: a `<select>` holding an unknown value renders blank, which reads
  as «все» while still filtering. `LogsPage` fetches the seller list **outside** `load()` — the 10 s
  auto-refresh must not re-fetch it — and swallows its error: the journal has to open without labels.
- **Queue jobs print who they belong to.** `QueuesController.jobs()` enriches rows the way
  `digests()` already does — one `access.list()` per page, never per row — resolving
  `data.telegramUserId ?? data.userId` (normalised with `String`: Redis keeps it a number, access
  records key by string) against `botId:telegramUserId` with a fallback to the bare id, since not
  every payload carries `botId`. The id itself moves out of the «Данные» summary into its own column,
  the same `@ник` + muted id shape as the «Рассылки» table above it. The whitelist in
  `queues.domain.ts` stays untouched — enrichment is the controller's job, as it is for digests.
- **«🤖 ИИ-сводка недели» card on «Очереди»** (TASK-168): one row per scheduled seller with the next run and
  the last `ai-weekly-digest` journal row, plus «Отправить сейчас» per row and for a typed id (an admin sends it
  to themselves — admins are never scheduled). Sending is confirmed in a modal: it is a paid AI call and a real
  message. Loaded outside the main `Promise.all`, like the finance card — its failure must not break the page.
- **«🔁 Передача остатков по расписанию» card on «Очереди»** (TASK-176): one row per scheduled seller with
  the next run and the last `stock-push-schedule` journal row (red when the pass was blocked), plus «Запустить
  сейчас» per row only — no typed id, since a pass writes into the seller's marketplace cabinets and admins
  are never scheduled. Confirmed in a modal; loaded outside the main `Promise.all`.
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
- **No component tests** — that would mean `jsdom` + `@vue/test-utils` for the panel's markup. What
  needs proving (login, throttle, guard, one-shot password generation) is tested on the backend.
