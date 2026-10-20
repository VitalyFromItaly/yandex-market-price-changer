# CRM продавца — фронт (`web/crm/`)

Vue 3 + Vite + Tailwind + shadcn-vue (reka-ui) + Pinia. Отдаётся Nest-процессом по `/crm/`; API —
`/api/crm/...` (см. `src/modules/crm/README.md`). Продавец видит кабинет под именем **MarketHub**
(тема и палитра — в «Доводах» ниже).

## Команды

```bash
npm run dev:crm        # vite на :5174, /api проксируется на :3004 (бэкенд — npm run dev)
npm run build:crm      # web/crm/dist; входит в npm run build
npm run typecheck:crm  # vue-tsc -p web/crm/tsconfig.json
npm run test:crm       # vitest --config web/crm/vitest.config.ts
```

## Устройство

- `src/navigation.ts` — пункты сайдбара: `MARKETPLACE_NAV` (аккаунт: обзор, магазины, рассылка,
  настройки, финансовые разделы, товары, ИИ-аналитик…), `STORE_NAV` (внутри магазина `/ym/stores/:store/...`), `ACCOUNT_NAV` (подключения,
  профиль, помощь). `name` пункта == ключ `CRM_SECTIONS` на бэкенде; какие показывать, решает сервер
  (`/auth/me` и `/ym/stores/:key`), до ответа меню пустое.
- Площадки (TASK-127): `ALL_MARKETPLACES` в `navigation.ts` — ЯМ, Ozon, WB (копия бэкендового
  `src/shared/marketplace.ts`, сверяется тестом). У каждой площадки буквальный префикс адресов, как у
  её API: `/ym/...` сейчас, `/ozon/...` и `/wb/...` с их разделами. Пока разделов нет, `/ozon` и
  `/wb` ведут на «Подключения», а прочие адреса под ними открывают страницу «скоро»
  (`modules/marketplaces`). Площадку из адреса отдаёт
  `useMarketplace()`, подключена ли она у продавца — `GET /api/crm/marketplaces` (стор
  `marketplaces`). Появились разделы у площадки — добавьте её в `LIVE_MARKETPLACES`, и
  заглушка уйдёт сама.
- «Подключения» (`/connections`, модуль `marketplaces`, TASK-161) — ключи всех площадок: карточка
  со статусом, маской ключа и датой проверки, «Проверить связь» и «Заменить ключ». Формы ключей
  (`YmTokenForm`, `OzonKeyForm`, `WbTokenForm`) живут только здесь. `/ozon`, `/ozon/connection`, `/wb` ведут сюда,
  «Магазины» — ссылкой. После замены или проверки стор перечитывает и карточки, и список площадок
  сайдбара (`useConnections.refresh`).
- `src/modules/<module>/` — модуль фичи: `api/`, `store/`, `composables/`, `mappers/`,
  `components/`, `pages/` (с `routes.ts`), `<module>.domain.ts`. Образец — `modules/auth`.
- `src/shared/` — общее: `http` (клиент, 401 → выход), `jobs` + `composables/useJob`,
  `useReportJob` (опрос фоновых задач, эхо периода), `useStoreKey`, `useRouteTabs`, `period`,
  `report-file`. В `period` два вида периода: отчётов о заказах (`period.ts`, периоды бота) и
  произвольный финансовый (`range.ts`: пресеты «Обзора», `previousRange` для динамики,
  `?from=&to=` + `useLinkedRange` для ссылок в «Финансы»).
- «Обзор» (`modules/overview`, TASK-125) — раздел аккаунта: деньги из финжурнала (`overview:summary`),
  срезы Маркета по всем магазинам (`overview:stocks`, `overview:cancelled`). Главная магазина —
  отдельный модуль `dashboard`.
- «ИИ-аналитик» (`modules/ai-analyst`, TASK-148) — раздел аккаунта: чат без кэша и без хранения,
  лента только в памяти вкладки; ход — `POST /turns` + опрос (`shared/composables/useTurn`, общий с
  «✨ Предложить ответ» в «Отзывах»), 409 — подхватить идущий. Раскрытие
  ссылок до операций — общий `shared/finance-operations` (тот же диалог, что у статьи «Финансов»).
- «Лента заказов» (`modules/order-feed`, TASK-144) — раздел аккаунта `/ym/order-feed`, не путать с `orders`
  (отчёты ЯМ по магазину): список — задача `order-feed:list` с периодом бота, фильтры площадки/этапа/товара —
  на клиенте и в query (`?mp=&stage=&q=`); заказ открывается диалогом, история операций грузится при открытии
  (`GET /ym/order-feed/:mp/:id`). Прибыль без операций — причиной, не нулём.
- «Аналитика возвратов» (`modules/returns-analytics`, TASK-145) — раздел аккаунта `/ym/returns-analytics`, задача
  `returns-analytics:summary` с `from/to`; переключатель площадки — только среди пришедших в ответе, разрез «По
  площадкам» без итога (площадки не складываются). Процент и потери приходят с сервера, фронт только подписывает.
- «Уведомления» (`modules/notifications`, TASK-152) — раздел аккаунта `/ym/notifications/:tab?`, вкладки «Лента» и
  «Настройки» (данные вкладки грузятся при её открытии). Лента — обычный HTTP, «Проверить сейчас» только ставит
  задачу; форма правил отправляет только изменённое (`rulesDiff`), пороги проверяет сервер. Блок «Telegram» — при
  `telegramAvailable` из ответа (фича `notifications_telegram`).
- `src/components/ui` — примитивы кита, `components/layout` — шелл.

## Правила

Структура модуля, сторы и дизайн экранов — в скиллах (см. «Доводы» ниже). Кратко: стор — тонкий
фасад с `reset()`, тексты и подписи приходят с сервера, если они есть у бота.

## Как добавить раздел

Модуль в `src/modules/`, его `pages/routes.ts` в роутере, пункт в `navigation.ts` — и строка
раздела на бэкенде (`CRM_SECTIONS`, паритет с ботом — см. `src/modules/crm/README.md`). Без строки
на бэкенде пункт не покажется никому.

## Доводы и история решений

> Перенесено из корневого `CLAUDE.md` (2026-10-18), чтобы он не грузил в каждую сессию то, что нужно
> только при работе в этом модуле. Выше — команды, устройство и порядок добавления раздела; здесь —
> почему каркас такой. Дубли прежнего README (hash-роутер, свои `tsconfig`/`vitest`, Tailwind в
> `vite.config.ts`, тема MarketHub, сессия) слиты сюда. Доводы API — в `src/modules/crm/README.md`.

**The seller CRM is a second SPA, `web/crm/`, served at `/crm/` by the same process** (TASK-069;
decisions `crm_location`, `crm_stack`). Structure, state and screen design are governed by the skills
in `.claude/skills/` (`frontend-module`, `pinia-store`, `frontend-design`) — they keep the rules, this
section keeps the reasons for the scaffold:

- **`useStaticAssets(web/crm/dist, {prefix: '/crm'})` is registered BEFORE the root one** for the admin
  panel. Both builds ship an `index.html` and a `favicon.svg`; express-static answers with the first
  match. Vite builds with `base: '/crm/'`, otherwise every asset URL points at the admin's root.
- **Hash router again** (`src/router/index.ts`), for the admin's reason (`web/admin/README.md`, «The admin panel is
  served by Nest itself») plus one more: a reload of a history-mode deep link
  would be an unmatched 404, and `AllExceptionsFilter` tags exactly those as `scanner` junk.
- **Its own `web/crm/tsconfig.json` (strict, `Bundler`, alias `@` → `web/crm/src`) and `web/crm/vitest.config.ts`**,
  not extensions of the root ones: the backend is node16 and deliberately loose, and the root vitest
  runs swc for Nest decorators over `__tests__/**` only. The `@` alias exists **only inside `web/crm/`** —
  the backend stays on relative imports.
- **PostCSS/Tailwind is configured inline in `web/crm/vite.config.ts`**, not as a `postcss.config.*` file:
  vite looks such a file up from its root upwards, and one badly placed config would run the admin
  build through Tailwind it does not have.
- **Unlike `web/admin/`, `web/crm/` is linted** — `eqeqeq` (the skill's "strict equality only") and the
  component size warnings would otherwise live on memory. Type-aware rules are off there
  (`disable-type-checked`): the root `project: true` does not cover a bundler tsconfig with `.vue`,
  and type checking is `vue-tsc`'s job. CI runs `typecheck:crm` and `test:crm` without `--if-present`.
- **Tokens are HSL** (`web/crm/src/assets/index.css`) so Tailwind can apply alpha. **The palette is the
  MarketHub mock-up's, not the admin's** (TASK-154, decision `crm_redesign_markethub_dark`): the CRM
  is a seller-facing product called MarketHub, the admin panel is an internal tool — the earlier
  "two tools of one owner must look like one product" argument lost to the owner's mock-up. Dark is
  the **default** (light — via the switcher in the sidebar; `useTheme` reads a missing key as `dark`, so «как в системе» is now stored
  explicitly — otherwise choosing it would read back as dark after a reload; the inline script in
  `web/crm/index.html` repeats that rule). The accent is blue; Yandex yellow survives only in the
  marketplace logo, which is what keeps "the cabinet" and "Market's site" apart. New tokens:
  `card-2` (panel gradient), `sidebar`, `--shadow-panel` (`shadow-panel`). Font is `@fontsource-variable/inter`,
  bundled — no external domain in `web/crm/dist` (checked by grep: only XML namespaces and Vue's
  error-reference text).
- Sections not yet built render `SectionPlaceholder` from `web/crm/src/navigation.ts` (сейчас так — «Рассылка»,
  TASK-081); a module's `pages/routes.ts` replaces its placeholder. Frontend deps are **devDependencies**, like `web/admin/`'s —
  the runner image does `npm ci --omit=dev` and needs only the built `web/crm/dist`.
- **The front (`web/crm/src/modules/auth`, the reference module for the skills)**: session in
  `sessionStorage` (`crm.session`, token + `mustChangePassword`, try/catch — no storage means an
  in-memory session); one pure `resolveAuthRoute` decides every redirect, and while
  `mustChangePassword` every route including a typed address goes to `/password`, which lives
  **outside** the shell (no sidebar — nothing there would open). `installAuth` wires the http
  client: a 401 **with** a session wipes all stores and returns to login with the server's reason;
  a 401 **without** one is the wrong password on the login form itself and must not read as «сессия
  истекла». The shell re-reads `/auth/me` when the tab becomes visible (≥30 s apart): a password
  changed in another tab otherwise surfaces only on a request, and a screen with no requests
  would never learn. The auth store has `clear()`, not `reset()` — `resetAllStores` on a store
  switch must not log out.
