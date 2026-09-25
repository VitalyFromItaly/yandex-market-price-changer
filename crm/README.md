# CRM продавца — фронт (`crm/`)

Vue 3 + Vite + Tailwind + shadcn-vue (reka-ui) + Pinia. Отдаётся Nest-процессом по `/crm/`; API —
`/api/crm/...` (см. `src/modules/crm/README.md`).

## Команды

```bash
npm run dev:crm        # vite на :5174, /api проксируется на :3004 (бэкенд — npm run dev)
npm run build:crm      # crm/dist; входит в npm run build
npm run typecheck:crm  # vue-tsc -p crm/tsconfig.json
npm run test:crm       # vitest --config crm/vitest.config.ts
```

Свои `tsconfig.json` (strict, алиас `@` → `crm/src`) и `vitest.config.ts` — корневые для бэкенда
не подходят. Алиас `@` есть только внутри `crm/`. Tailwind подключён прямо в `vite.config.ts`.

## Устройство

- `base: '/crm/'`, роутер на hash-истории (`src/router/index.ts`): перезагрузка глубокой ссылки не
  уходит на сервер.
- `src/navigation.ts` — пункты сайдбара: `MARKETPLACE_NAV` (аккаунт: магазины, рассылка,
  настройки), `STORE_NAV` (внутри магазина `/ym/stores/:store/...`), `ACCOUNT_NAV` (профиль,
  помощь). `name` пункта == ключ `CRM_SECTIONS` на бэкенде; какие показывать, решает сервер
  (`/auth/me` и `/ym/stores/:key`), до ответа меню пустое.
- `src/modules/<module>/` — модуль фичи: `api/`, `store/`, `composables/`, `mappers/`,
  `components/`, `pages/` (с `routes.ts`), `<module>.domain.ts`. Образец — `modules/auth`.
  Раздел без модуля показывает `SectionPlaceholder` (сейчас так — «Рассылка», TASK-081).
- `src/shared/` — общее: `http` (клиент, 401 → выход), `jobs` + `composables/useJob`,
  `useReportJob` (опрос фоновых задач, эхо периода), `useStoreKey`, `useRouteTabs`, `period`,
  `report-file`.
- `src/components/ui` — примитивы кита, `components/layout` — шелл.
- Сессия — в `sessionStorage` (`crm.session`); пока нужна смена пароля, любой маршрут ведёт на
  `/password`.

## Правила

Структура модуля, сторы и дизайн экранов — в скиллах `.claude/skills/frontend-module`,
`pinia-store`, `frontend-design`. Кратко: стор — тонкий фасад с `reset()`, строгое равенство
(`eqeqeq` в линтере), тексты и подписи приходят с сервера, если они есть у бота.

## Как добавить раздел

Модуль в `src/modules/`, его `pages/routes.ts` в роутере, пункт в `navigation.ts` — и строка
раздела на бэкенде (`CRM_SECTIONS`, паритет с ботом — см. `src/modules/crm/README.md`). Без строки
на бэкенде пункт не покажется никому.
