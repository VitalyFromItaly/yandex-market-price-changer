# CRM продавца — бэкенд (`src/modules/crm/`)

Веб-кабинет продавца поверх тех же сервисов, что у Telegram-бота. Фронт — `crm/` (см.
`crm/README.md`), отдаётся тем же процессом по `/crm/`, API — под `/api/crm/...`. Здесь — правила;
почему они такие, записано в `CLAUDE.md` (разделы «CRM продавца: обзор» и ниже).

Главное правило: **одна логика — два канала.** CRM не считает ничего сама — отчёты, запись
остатков, ставки, карантин, отзывы идут через те же сервисы `YandexModule` / `ReportsModule`, что
и бот. Своими здесь бывают только доставка (HTTP, фоновая задача) и разбор параметров.

## Карта

| Каталог / файл                                                                                            | Что                                                                        |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `crm-auth.*`, `crm-jwt.guard.ts`                                                                          | вход, смена пароля, гвард всех маршрутов                                   |
| `crm-features.domain.ts`                                                                                  | разделы CRM → фичи (`CRM_SECTIONS`), разделы магазина, причины 403         |
| `crm-parity.domain.ts`                                                                                    | паритет с ботом: фичи без раздела и кнопки меню → раздел                   |
| `crm-action-log.*`                                                                                        | журнал каждого запроса CRM в `actionlogs` (`source: 'crm'`)                |
| `jobs/`                                                                                                   | фоновые задачи CRM: очередь `crm-jobs`, `CrmJobResult`, `/api/crm/ym/jobs` |
| `stores/`                                                                                                 | список магазинов токена, вход в магазин по ключу, смена токена             |
| `orders/`, `profit/`, `payments/`, `market-reports/`, `recommendations/`, `cards/`, `fby/`, `warehouses/` | kind-ы фоновых задач — отчёты                                              |
| `price-list/`                                                                                             | загрузка прайса (в очередь бота `file-processing`) и список закупа         |
| `settings/`                                                                                               | ставки, скидки по брендам, продвижение — через `StoreSettingsService`      |
| `quarantine/`, `feedback/`                                                                                | карантин цен и отзывы — через `QuarantineService` / `FeedbackService`      |
| `profile/`                                                                                                | профиль и справка — из `profileView` / `helpModel` бота                    |

## Вход

- `POST /api/crm/auth/login {login, password}`: логин — ник Telegram (без `@`, без регистра) или
  числовой id. Пускают одобренных продавцов с подключённым магазином и админов из
  `TELEGRAM_ADMIN_IDS` с магазином.
- Учётка создаётся при первом успешном входе со стартовым паролем `CRM_INITIAL_PASSWORD`
  (по умолчанию `tg_rules_2026`). До смены пароля (`POST /api/crm/auth/password`, ≥10 символов, не
  стартовый) открыты только `/auth/me` и `/auth/password`, остальное — 403
  `PASSWORD_CHANGE_REQUIRED`.
- Забытый пароль сбрасывает администратор с карточки продавца в панели
  (`POST /api/access/users/:id/crm-password-reset`) — обратно на стартовый.
- Ссылки на CRM в боте нет (решение владельца `crm_bot_link_dropped`): адрес продавцу сообщает
  администратор.

## Барьеры

Все проверки — внутри `CrmJwtGuard`, второго гварда нет:

1. JWT с `aud: 'crm'` (секрет общий с админкой, админский токен сюда не подходит, и наоборот).
2. `pwdv` — момент смены пароля: сменил пароль — старые токены мертвы.
3. `UserAccess` перечитывается на каждом запросе: закрытый в боте или панели доступ закрывает CRM сразу.
4. `@RequireFeature(...keys)` — нужны все ключи, неизвестный ключ закрыт; 403 `FEATURE_DISABLED`
   или `FBY_ONLY`. Правило то же, что у бота (`isFeatureOpen`); модель — ОТКРЫТОГО магазина.
5. Магазин — из адреса: ключ `storeKeyOf` (16 hex от sha256 campaignId). Кампании нет в кэше
   `stores` токена → 404 `STORE_NOT_FOUND`. Веб не пишет активный магазин бота
   (`scopeStore` подменяет его в копии документа).
6. Запись остатков: env `STOCK_WRITE_ENABLED` → фича `stock_update` → модель (FBY — только
   чтение) → последний барьер в `writeInBatches`. Ранний слой общий с ботом
   (`StockUploadPolicyService`).

## Фоновые задачи

- `POST /api/crm/ym/jobs {kind, params, store}` → `{jobId, created}`; опрос `GET /jobs/:id`, файл
  `GET /jobs/:id/file`. Kind регистрируется модулем фичи в `CrmJobsRegistry` (`onModuleInit`).
- Результат — в Mongo (`CrmJobResult`, TTL 24 ч, потолок 15 МБ), не в Redis.
- Одна идущая задача на `(продавец, kind, магазин)` — уникальный индекс по `activeKey`; повторный
  POST возвращает идущую (`created: false`). Эхо периода в ответе обязательно.
- Payload без токена; фичи едут снимком (`context.features`) — у админа нет `UserAccess`.
- `CrmJobError` — текст продавцу, без алерта; прочие ошибки — `ErrorReporter`.
- `data` готовой задачи никогда не `null` — пустой результат несёт `emptyText`.
- Прайс — исключение: не kind, а `SYNC_STOCKS` в очередь бота `file-processing` (одна запись
  остатков за раз на обоих каналах), итог пишется в `CrmJobResult` с kind `price-list:upload`.

## Паритет с ботом

`__tests__/unit/crm-parity.test.ts` падает, если:

- ключ `FEATURE` не стоит ни в одном разделе `CRM_SECTIONS` и не записан в
  `FEATURES_WITHOUT_SECTION` с причиной (сейчас там `promotion`, `deep_history`, `fby_supply`,
  `hosting_reminder`);
- кнопка `MENU` ведёт в несуществующий раздел или в раздел, не открываемый её же фичей.

Новый ключ `MENU` без строки в `BOT_SCREEN_SECTIONS` не компилируется. «Рассылка» (`ym-schedule`) —
пока заглушка (TASK-081), паритет держит ей место.

## Как добавить раздел

1. Ключ в `CRM_SECTIONS` (+ `CRM_STORE_SECTIONS`, если раздел внутри магазина).
2. Пункт с тем же `name` в `crm/src/navigation.ts` (`STORE_NAV` или `MARKETPLACE_NAV`/`ACCOUNT_NAV`) —
   совпадение пинит `crm-features.test.ts`.
3. Если раздел — экран бота: строка в `BOT_SCREEN_SECTIONS`; если новая фича — в разделе или в
   `FEATURES_WITHOUT_SECTION`.
4. Маршруты под `@RequireFeature`, долгие отчёты — kind в `CrmJobsRegistry`, логику — из общего
   сервиса, а не копией.
