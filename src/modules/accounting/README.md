# «Финучёт» — фактический финансовый учёт (M29–M33)

Второй механизм учёта **рядом** с текущим расчётом прибыли (решение `accounting_beside_current`).
Источник — ТЗ «Фактический финансовый учёт» от 2026-11-08 (обезличено: продавец любой, решение
`accounting_generic`). Матрица доступности данных и противоречия ТЗ — `docs/accounting-data-matrix.md`.

## Правила

- **Текущий расчёт не трогаем.** `pnl.ts`, `order-feed.ts`, `returns-analytics.ts`, `profit-actual.ts`,
  статус периода и плоская формула отсюда не зовутся и не меняются; их тесты зелёные без правок ожиданий.
- **Фичи:** зонтик `fin_accounting` открывает раздел CRM `ym-accounting` (`/ym/accounting`). Подфичи
  `fin_accounting_{orders,returns,lots,reconcile,dashboard}` требуют зонтик (`requires`) и открывают
  свои вкладки; все `defaultEnabled: false`. Подфича без зонтика ничего не открывает. В `crm-parity`
  подфичи числятся вкладками раздела (`FEATURES_WITHOUT_SECTION`).
- **Раздел только в CRM:** кнопки в боте нет, `featureGate` закрывать нечего; список фич админка
  берёт из `GET /api/access/features`.
- **Модули:** доменный `AccountingModule` (`accounting.module.ts`, `AccountingService`) не тянет ни граф бота,
  ни CRM. Доставка — `src/modules/crm/accounting/` (`CrmAccountingController`, `crm/ym/accounting`,
  `@RequireFeature(FEATURE.FIN_ACCOUNTING)` на классе; маршрут вкладки добавляет свою подфичу).
- Журнал — тот же `finance_operations` (`accounting_same_journal`), неизвестная закупка — `null`
  (`accounting_unknown_cost_strict`), распределённое всегда помечено (`accounting_allocated_is_labeled`).

## Карта модуля (ТЗ п.16)

Сводка для передачи; алгоритмы расписаны в разделах ниже, здесь только где что искать.

| Что                                            | Ядро (чистые функции)                                           | Раздел                                               |
| ---------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------- |
| Реестр операций, подстатьи                     | `accounting-sub-articles.ts` (`accountingColumnsOf`)            | «Реестр операций»                                    |
| Загрузка из API, повторы, журнал синхронизации | `finance-import.processor.ts`, `finance-schedule.ts`            | «Загрузка: расписание и надёжность»                  |
| Ручные операции, отчёт WB файлом               | `manual-operation.domain.ts`, `finance/wb-promotion-file.ts`    | «Ручные операции», «Отчёты файлом»                   |
| Цены сделки (строки заказов)                   | `ozonOrderLines`, `wbOrderLine`                                 | «Снимок строк заказов»                               |
| Историческая закупка (режим А)                 | `accountingCostAt`, `accountingUnitCost`                        | «История закупа v2»                                  |
| Партии и FIFO (режим Б)                        | `accounting-lots.domain.ts` (`fifoAllocate`, `extraShares`)     | «Партии», «FIFO-списание»                            |
| Прибыль заказа / возврата                      | `order-result.ts`, `return-result.ts`                           | «Результат заказа», «Результат возвращённого заказа» |
| Три состояния прибыли, снимки                  | `order-profit-state.ts`                                         | «Состояние прибыли и снимки»                         |
| Распределение общих расходов                   | `store-cost-allocation.ts`                                      | «Распределение общих расходов»                       |
| Налог                                          | `accounting-tax.ts` поверх `finance/tax.ts`                     | «Налог нового учёта»                                 |
| Сверка v2                                      | `accounting-reconcile.domain.ts`                                | «Сверка v2»                                          |
| Карточка, список, возвраты, панель, аналитика  | `accounting-{order-card,returns,dashboard,analytics}.domain.ts` | одноимённые разделы                                  |

Что из полей ТЗ каждая площадка отдаёт, с какой задержкой и что противоречит ТЗ — матрица
[`docs/accounting-data-matrix.md`](../../../docs/accounting-data-matrix.md); здесь её не повторяем.

## Методы API площадок

«Финучёт» площадки **только читает**: записи (цены, остатки, ответы) у него нет. Клиенты — общие с текущим учётом,
своих запросов нет, кроме отмеченных.

- **ЯМ:** `POST /v2/reports/united-netting/generate` (журнал), `united-marketplace-services` (расшифровка сводной
  строки акта, документ сверки), `GET /campaigns/{id}/orders` по всем магазинам кабинета (строки заказов, TASK-210).
- **Ozon:** `/v1/finance/accrual/by-day` + справочник `/v1/finance/accrual/types` (журнал), `/v1/finance/balance`
  (выплаты и сальдо месяца — документ сверки, TASK-227), `/v4/posting/fbs/list` и `/v3/posting/fbo/list` с
  `with.financial_data` (строки заказов, TASK-211).
- **WB:** `sales-reports/detailed` (отчёт реализации — журнал), supplier/orders и supplier/sales «Статистики» (строки
  заказов, TASK-211). Реклама WB — файл кабинета «Продвижение», API не вызывается.

Подробности по полям и строкам кода — матрица, раздел «Источники».

## Структура реестра (Postgres)

Всё «Финучёта» лежит в Postgres (`finance.schema.ts`); в Mongo он ничего не пишет — читает фичи (`UserAccess`),
креды и товары (`Product`). Миграции — `drizzle/`, применяются при старте приложения.

| Миграция         | Таблицы / колонки                                                                               | Назначение                           |
| ---------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------ |
| 0012             | `finance_operations` + `currency`, `item_id`, `reported_at`, `processing_status`, `sub_article` | реестр — тот же журнал               |
| 0013             | `finance_sync_runs`                                                                             | попытки загрузки по месяцам, 90 дней |
| 0014             | `accounting_manual_operations`, `…_changes`                                                     | ручные операции и их журнал          |
| 0015, 0016       | `accounting_order_lines`, `…_line_versions`, `accounting_order_sync_state`                      | цены сделки, версии, курсор опроса   |
| 0017             | `accounting_cost_records`, `…_changes`                                                          | история закупа v2                    |
| 0018             | `accounting_order_results`, `…_result_versions`                                                 | снимки результата заказа             |
| 0019, 0020, 0023 | `accounting_{allocation,tax,cost}_settings`                                                     | методика, агентская база, режим А/Б  |
| 0021             | `finance_ozon_balances`                                                                         | сальдо месяца Ozon                   |
| 0022             | `accounting_lots` + поля доставки в `finance_purchases`                                         | партии                               |
| 0024             | `finance_expenses` + `source`, `scope`, `marketplace`, `order_id`, `sku`, …                     | расходы с привязкой (TASK-220)       |

Таблицы версий и журналы изменений только дописываются; «текущее» лежит в головной таблице рядом.

## Три состояния прибыли

Каждый заказ — ровно в одном состоянии (`orderProfitStateOf`, раздел «Состояние прибыли и снимки»):
**прогноз** (`forecast`) — операций площадки по заказу ещё нет, комиссия и логистика — средние ставки;
**предварительно** (`preliminary`) — операции есть, но месяц не сверен, сверка нашла расхождение или в карточке осталось
ожидаемое/неизвестное; **сверено** (`reconciled`, `final`) — месяц сверен и все суммы фактические или распределённые.
Подтверждённое (`confirmedKopecks`) и ожидаемое (`expectedKopecks`) не складываются в одно число без подписи;
неизвестная обязательная строка — прибыль `null`, не 0.

## Ограничения API

Чем ограничены частота загрузки и полнота (числа и источники — матрица, «Задержка появления и частота опроса»):

- **ЯМ:** генерация отчёта — 1 в минуту на кабинет и 100 в час (обёртка ждёт 65 с, 3 попытки); месяц дописывается
  актами и выплатами ещё недели — отсюда окно перезагрузки `FIN_ACCOUNTING_RELOAD_MONTHS`. Отчёта о реализации нет —
  у продаж и возвратов в сверке документа нет.
- **Ozon:** 429 уже на ~0,3 rps — дни строго последовательно; `balance` — окнами ≤ 30 дней; начисления дописываются
  задним числом до ~3 дней; до доставки выплата и комиссия отправления — нули (у нас `null`).
- **WB:** «Статистика» — 1 запрос в минуту на токен (пауза 61 с, очередь общая с «Передачей остатков»), отчёт реализации
  — раз в неделю: чаще ночи WB не опрашивается. Документа для сверки нет вовсе; баланс — только текущий.
- **Чего нет ни у кого** (матрица, «Чего нет в строке журнала»): позиции операции, дата отражения в отчёте, статус
  обработки, состояние возвращённого товара, валюта у ЯМ — колонки `null`, а не догадка.

## Восстановление синхронизации

Когда карточка «Синхронизация» в CRM показывает старое «данные на» или ошибку месяца, либо пришло уведомление
`finance_sync_failed`. Все скрипты поднимают Nest без `AppModule` — вебхук боевого бота не трогают; месяц у
`import-finance` пишется `ММ-ГГГГ`, у `diagnose-accounting` — `ГГГГ-ММ`. `.env` скрипты проверяют той же Joi-схемой,
что приложение: без обязательного ключа (например, `PRICE_WRITE_ENABLED`) скрипт не стартует — задать ключ в `.env`
или в окружении команды.

1. **Где сломалось.** CRM — `SyncStatusCard` (`GET crm/ym/accounting/sync`: последний успех отдельно от последней
   попытки, ошибка и пропуск по месяцам окна). В базе:

   ```sql
   SELECT marketplace, period_key, trigger, attempt, outcome, left(error, 120) AS error, finished_at
   FROM finance_sync_runs WHERE telegram_user_id = '<id>' ORDER BY finished_at DESC LIMIT 20;
   SELECT marketplace, last_outcome, last_error, last_success_at, cursor_at
   FROM accounting_order_sync_state WHERE telegram_user_id = '<id>';
   ```

   Админка «Очереди» → «📒 Загрузка финансов»: частые `finacc-<uid>`, повторы `finretry-…`, упавшие задачи.

2. **Причина.** Креды отозваны или площадка отключена — переподключить в «Подключениях», загрузка возобновится сама.
   Квота ЯМ (100 генераций в час) — подождать час, не перезапускать подряд. Postgres недоступен — самопроверка
   покажет «down». Миграции не применились (алерт `postgres:migrate`, ошибки «нет таблицы») — `npm run db:pg:migrate`
   или рестарт; перед этим резервная копия (раздел ниже).
3. **Журнал месяца.** Обычно ничего делать не нужно: частая задача сама ставит пропущенные месяцы окна
   (`missedToQueue`), ночь перезагружает окно. Срочно или вне окна — тем же сервисом, что очередь:
   `npx ts-node scripts/import-finance.ts --user=<id> --month=ММ-ГГГГ [--marketplace=ozon|wb]` (тратит квоту ЯМ; Ozon
   без актов и сверки). Повтор безопасен: тот же sha256 — `unchanged`.
4. **Строки заказов.** `npx ts-node scripts/sync-accounting-orders.ts --user=<id> --marketplace=all [--days=7]`
   (`--from-cursor` — от сохранённого курсора). При сбое курсор не сдвигается, повтор берёт то же окно.
5. **Колонки реестра у строк до 0012** — `scripts/backfill-accounting-registry.ts --user=<id>` (dry run), затем
   `--apply`.
6. **Проверка.** `npx ts-node scripts/diagnose-accounting.ts --user=<id> --month=ГГГГ-ММ` — заказы, возвраты, сверка
   месяца теми же сервисами, что CRM; в карточке «Синхронизация» — новый успех.

## Резервная копия перед миграциями

Приложение применяет новые файлы `drizzle/` само при старте, отката у drizzle нет. Поэтому **перед деплоем, где в
`drizzle/` появилась миграция**, а также перед `npm run db:sync-indexes` и скриптами с `--apply` — копия обеих баз.
Имена сервисов и порты — `docker-compose.yml` (`postgres` 5433, `mongodb` 27018), креды и имя базы Mongo — `.env`.
`docker compose exec` требует, чтобы `.env` проходил подстановку compose (обязательные ключи заданы); иначе — `docker
exec <контейнер>` с тем же хвостом.

```bash
mkdir -p backup && TS=$(date +%Y%m%d-%H%M)
# Postgres (финансы и «Финучёт»), формат custom — для выборочного восстановления
docker compose exec -T postgres pg_dump -U finance -d finance -Fc > backup/finance-$TS.dump
# Mongo (всё остальное), одним архивом
docker compose exec -T mongodb mongodump -u root -p '<пароль>' --authenticationDatabase admin \
  --db '<MONGODB_DATABASE>' --archive --gzip > backup/mongo-$TS.archive.gz
# копия читается
docker compose exec -T postgres pg_restore --list < backup/finance-$TS.dump | head
docker compose exec -T mongodb mongorestore -u root -p '<пароль>' --authenticationDatabase admin \
  --archive --gzip --dryRun < backup/mongo-$TS.archive.gz
```

Копию унести с хоста (база и копия на одном диске — не копия). Проверить её восстановлением, не трогая рабочую
базу: `createdb -U finance finance_restore_check`, `pg_restore -U finance -d finance_restore_check --no-owner`,
сравнить `count(*)` у `finance_operations` и `public.__drizzle_migrations`, `dropdb`.

Отката миграций нет, откат — восстановление:

1. Остановить приложение (`docker compose stop app`) — иначе на старте оно снова применит миграцию.
2. `docker compose exec -T postgres pg_restore -U finance -d finance --clean --if-exists < backup/finance-<TS>.dump`
   (вместе со схемой вернётся и `public.__drizzle_migrations` — список применённых миграций).
3. Если копировалась Mongo: `docker compose exec -T mongodb mongorestore -u root -p '<пароль>' --authenticationDatabase
admin --drop --archive --gzip < backup/mongo-<TS>.archive.gz`.
4. Вернуть прошлую версию образа (без новой миграции), запустить, проверить самопроверку и `diagnose-accounting`.

Всё, что площадки прислали после копии, вернёт обычная загрузка (окно перезагрузки, раздел выше); ручные операции,
исправления закупа и закупки, введённые после копии, — нет: их нужно ввести заново.

## Реестр операций (ТЗ п.10, TASK-207)

- Реестр = `finance_operations` (`accounting_same_journal`) плюс nullable-колонки `currency`, `item_id`,
  `reported_at`, `processing_status`, `sub_article` (миграция `drizzle/0012_accounting_registry_columns.sql`).
  `article` и его правила не меняются; текущий P&L новые колонки не читает.
- Колонки ставит одна чистая функция `accountingColumnsOf` (`accounting-sub-articles.ts`) — её зовут построители
  строк ЯМ/Ozon/WB (`nettingRowToOperation`, `ozonAccrualToRow`, `wbRowToOperation`) и бэкфилл.
- **Подстатья** — закрытый union `TAccountingSubArticle`; таблицы `Record<известный тип, подстатья>` по
  площадке. Ключи сверены с классификаторами статей тестом (`accounting-sub-articles.test.ts`): тип, известный
  статье, известен и подстатье. Незнакомое — `unknown`, никогда не «прочее». Штрафов ЯМ в карте нет — `unknown`.
- **Null, а не выдумка:** валюта — только явное поле raw (Ozon `total_amount.currency`, WB `currency_name`); позиции,
  даты отражения в отчёте и статуса обработки площадки не дают (матрица, п.20) — `null`.
- **Повторный импорт** дозаполняет колонки, пустое не стирает (`COALESCE` в `MUTABLE_ON_CONFLICT`).
- **Бэкфилл** — `scripts/backfill-accounting-registry.ts [--user=…] [--marketplace=…] [--apply]` (dry run по
  умолчанию), ядро — `accounting-registry-backfill.ts`. Обновляет только строки, где вычисленное отличается;
  `unknown` и пустое не затирают записанное импортом (`mergeRegistryColumns`). У Ozon имена типов есть только
  у импорта (справочник `/v1/finance/accrual/types`), в базе — лишь в `breakdown` многостатейных строк: сбор
  без расшифровки бэкфилл узнать не может, его доклассифицирует следующий импорт периода.

## Загрузка: расписание и надёжность (ТЗ п.11, TASK-212)

- **Журнал синхронизации** — `finance_sync_runs` (миграция 0013): строка на попытку периода — площадка, период,
  кто запустил (`nightly|frequent|manual|retry|missed`), номер попытки, исход, ошибка (≤ 500 символов), время.
  Пишет процессор finance-import у всех продавцов; последний **успех** считается отдельно от последней попытки
  (`FinanceSyncRunRepository.states`). Хранится 90 дней (чистка в ночном проходе). `finance_periods` не меняется.
- **Кому:** зонтик `fin_accounting` + подключённая площадка (`pickAccountingMarketplaces`); `finance` не нужна.
  Админов в авторасписании «Финучёта» нет (довод `notifications_admins_not_auto`).
- **Частая задача** `finacc-<uid>` (решение `accounting_sync_frequent_3h`): текущий месяц ЯМ и Ozon раз в
  `FIN_ACCOUNTING_SYNC_EVERY_HOURS` (умолч. 3); WB — только ночью. Тот же проход ставит **пропущенные** месяцы окна
  (успеха не было, последняя попытка старше интервала, `missedToQueue`).
- **Ночью** — окно перезагрузки `FIN_ACCOUNTING_RELOAD_MONTHS` (умолч. 3) поверх обычных месяцев: отчёт с
  задержкой забирается сам, пока месяц в окне. У продавцов без «Финучёта» ночной проход прежний.
- **Повторы с backoff** — не `attempts` Bull (квота ЯМ, сон держал бы concurrency 1 очереди), а отложенные разовые
  задачи `finretry-<mp>-<uid>-<ГГГГ-ММ>-<n>` в той же очереди: 10, 20, 40 мин (`FIN_ACCOUNTING_RETRY_ATTEMPTS`,
  умолч. 3). Номер повтора — в id: повтор ставится, пока предыдущая задача ещё активна.
- **Сбой после последнего повтора** → правило уведомлений `finance_sync_failed` (`notifications/README.md`).
- **CRM:** `GET crm/ym/accounting/sync` → `AccountingService.syncStatus`: по площадке «данные на <последний успех>»,
  по месяцам окна — исход, ошибка, пропуск. Экран — `web/crm/src/modules/accounting/` (`SyncStatusCard`).
- **Админка «Очереди»:** карточка «📒 Загрузка финансов» показывает и частые задачи (`kind: frequent`).

## Ручные операции (ТЗ п.1, TASK-208)

- **Своя таблица** `accounting_manual_operations` + журнал `accounting_manual_operation_changes` (миграция 0014),
  решение `accounting_manual_ops_own_table`. В `finance_operations` их нет: ни один читатель текущего механизма
  (`liveForPnl`, `livePaidBetween`, `receivableByArticle`, `liveForReconcile`, `actJournalSums`, `liveByOrderIds`,
  `liveForPayout`) и ни `markSuperseded`/`findStale` их не видят — P&L не меняется, загрузка из API не «заменит»
  ручную строку. Новый движок читает их через `AccountingManualOperationsService.liveFor`.
- **Контракт** — как у строки журнала: площадка, статья (`TFinanceArticle` без `unknown`), подстатья
  (`TAccountingSubArticle` без `unknown`, необязательна), сумма со знаком в целых копейках (≠ 0, `toKopecks`), день,
  заказ/SKU (необязательны), **источник обязателен**, номер документа и комментарий — по желанию
  (`manual-operation.domain.ts`).
- **Идемпотентность формы:** форма заводит uuid `clientKey` при открытии и шлёт его с каждой отправкой; уникальный
  индекс `(telegram_user_id, client_key)` — повтор возвращает уже созданную строку, без второй записи журнала.
- **Журнал изменений:** создание, правка, удаление — `before`/`after` (значение формы целиком), автор и админ «за
  продавца», в одной транзакции с операцией. Правка без изменений и повторное удаление журнал не пополняют.
  Удаление мягкое (`deleted_at`): история остаётся и открывается и у удалённой.
- **CRM:** маршруты под `CrmAccountingController` (зонтик `fin_accounting`), фронт — `ManualOperationsCard`,
  `ManualOperationDialog`, `ManualOperationHistoryDialog` на странице «Финучёта».

## Отчёты файлом (ТЗ п.11, TASK-209)

- **Только отчёт кабинета WB «Продвижение»** (`accounting_upload_wb_promotion_only`): это единственная file-ячейка
  матрицы `docs/accounting-data-matrix.md` (реклама WB, п.6). У Ozon файловых ячеек нет; отчёт реализации WB и
  начисления Ozon идут из API.
- **В том же журнале, но справочно** (`accounting_upload_reference_only`): строки — `finance_operations` со статьёй
  `promotion_report` (группа `reference`, как `bonus_payment`) и подстатьёй `advertising`. Реклама WB в API уже
  внутри `deduction` → `withholdings`; статьёй `promotion` она посчиталась бы дважды. Группа `reference` не входит в
  прибыль, налог, ДДС, выплаты и сверку по построению — числа текущего P&L не двигаются (тест
  `finance-wb-promotion-upload.test.ts`). В ручные операции статья не предлагается (`isManualArticle`).
- **Свой тип отчёта** `wb-promotion` (`WB_PROMOTION_REPORT_TYPE`): свой ключ периода — API-импорт WB (`findStale` по
  ключу периода) строки файла не снимает, и счётчики версий документа с отчётом реализации не пересекаются.
- **Путь записи общий с ЯМ:** `WbFinanceService.importPromotionFile` → `FinanceImportService.importFileBatch` →
  `importRows` (площадка и тип отчёта — параметры). Тот же sha256 — `unchanged`; ручная версия только добавляет
  (`finance_upload_append_only`). Ключ — `['wb-promotion', кампания, документ, момент, копейки]`: пары в API у
  списания нет, поэтому ключ свой, а не `wbOperationKey`.
- **Парсер** `src/modules/finance/wb-promotion-file.ts` — без образца (`accounting_upload_no_sample`): синонимы — поля
  `adv/v1/upd` плюс угаданные подписи кабинета; отказы — `NettingFileError` тех же видов, что у ЯМ.
- **CRM:** `POST crm/ym/accounting/uploads/wb-promotion` (multipart `file` + `month`) под `fin_accounting` +
  `fin_accounting_uploads`; карточка `WbPromotionUploadCard` на странице «Финучёта».

## Сверка v2 (ТЗ п.12, TASK-226; Ozon/WB — TASK-227)

- **Рядом с текущей `reconcile()`**: чистая `reconcileV2` (`accounting-reconcile.domain.ts`) + `AccountingReconcileService`.
  Считается на запрос, только читает Postgres; `finance_periods`, `finance_discrepancies`, статус месяца не пишутся,
  площадка не зовётся. Маршрут — `GET crm/ym/accounting/reconcile?month=ГГГГ-ММ&marketplace=ym|ozon|wb` (подфича
  `fin_accounting_reconcile`), диагностика — `scripts/diagnose-accounting.ts --user=… --month=ГГГГ-ММ` (только ЯМ).
- **Площадка** — `reconcile(user, period, now, marketplace = 'ym')`: тип отчёта загрузки месяца —
  `FINANCE_REPORT_TYPE[marketplace]` (файл WB «Продвижение» загрузкой месяца не считается), «данные на» — успех
  загрузки этой площадки, ручные операции — только её. Документ статьи по площадке — `RECONCILE_LINE_DOCUMENT`
  (`Record` по площадкам: новая площадка не соберётся без своей строки).
- **Ozon** (решение `accounting_reconcile_ozon_balance`): документ — сальдо закрытого месяца `/v1/finance/balance`
  (`finance_ozon_balances`: входящее, начислено, выплачено, исходящее; пишет импорт Ozon после раскладки выплат,
  `OzonSellerClient.balanceOfPeriod` — окнами ≤ 30 дней). «Итог начислений» — реестр против `accrued`; «остаток» —
  входящее + начислено по реестру − выплачено по Ozon против `closing_balance`. Статьи по отдельности, выплаты и акты —
  без документа. Ozon не отдал `accrued`/`closing` — у этой статьи документа нет (null, не 0).
- **WB** (решение `accounting_reconcile_wb_no_document`): документа нет ни у одной статьи, поручения
  (`realizationreport_id`) в `paymentOrders` не попадают — их «сумма» есть Σ тех же строк.
- **Ни одного документа** у статей и актов — итог `insufficient_data` с пометкой «у <площадки> нет документа для
  сверки» (решение `accounting_reconcile_zero_documents`). Соседние месяцы требуются только ЯМ.
- **Статьи**: продажи, возвраты и корректировки, комиссии, логистика, прочие услуги, компенсации и субсидии, не
  распознано, итог начислений, выплаты, остаток взаиморасчётов (`RECONCILE_LINE_META`). Строка журнала ложится в
  статью по своей `article` (`RECONCILE_LINE_OF_ARTICLE`, группы как у обзора «Финансов»), сводная строка акта — по
  частям расшифровки. Подстатья — в кандидатах, для показа.
- **Документы ЯМ — только два**: акт + отчёт услуг (`finance_act_services`, итог и `sheets`) у комиссий, логистики и
  прочих услуг; платёжные поручения (`bankOrderId`/`bankSumKopecks`) у выплат. Отчёта о реализации нет → у остальных
  статей `no_document` с причиной, не выдумка.
- **Базис статей акта** — тот же, что у сверки акта текущего механизма: строки дней актов, лежащих в отчёте месяца
  (`actDaysOfPeriod`), по всему окну журнала, плюс ручные операции статьи за месяц. Документ — −Σ листов статьи
  (`YM_RECONCILE_SHEET_ARTICLE`: листы сводной строки + листы «по заказу» по названию услуги). Лист вне карты или
  нет отчёта к акту — статьи акта `no_document`; итог акта (`acts[]`) сравнивается всё равно.
- **Выплаты** — движение денег, не прибыль: группы `bankOrderId` с днём выплаты в месяце, Σ денег (без «оплачено
  баллами») против суммы поручения; разные суммы у строк одного поручения — расхождение.
- **Кандидаты разницы** (только у `mismatch`): `duplicate` (тот же заказ, статья, подстатья, услуга, сумма, день),
  `other_date` (начислена в месяце, а акт другой/нет; или в акте месяца, а начислена вне его), `no_pair` (ручная —
  Маркет её не знает; или |сумма| = |разница|). Первыми — равные разнице. Ссылок ≤ `MAX_FINDING_OPERATION_REFS`.
- **Без номера заказа** — `storeLevel` (сводная строка акта, ручные без заказа), считаются в `unmatchedCount`.
- **Итог**: `insufficient_data` — месяц не закончился, или журнал месяца/соседа не загружен (строки поручений и
  актов лежат в M−1…M+1, довод `finance_reconcile_neighbors`); иначе `discrepancies` при любом `mismatch`, иначе
  `reconciled`. `partial` — у части статей документа нет (решение `accounting_reconcile_status_available`).
  Допуск — `RECONCILE_TOLERANCE_KOPECKS` (0 коп.). «Сверено» — время расчёта, «данные на» — последний успех
  загрузки ЯМ (`finance_sync_runs`).
- **Ручные операции** входят в суммы статей (`manualKopecks`), только своей площадки (решение
  `accounting_reconcile_manual_included`).
- **Экран CRM** (TASK-228): `web/crm/src/modules/accounting/components/ReconcileSection.vue` — выбор закрытого месяца,
  итог со «сверено … · данные на …», таблица статей с раскрытием расхождения до операций, документы (акты и
  поручения), операции без заказа. Слайс стора — `useReconcile.accounting.ts` (месяц и площадка; null — сервер берёт
  первую доступную), вид — `mapReconcile.accounting.ts` (заголовки «Сверка с Маркетом / Ozon / WB»). Выбор площадки —
  `OptionGroup`, как у заказов, при > 1 варианте из `marketplaceOptions` ответа.
- **Заказ**: `orderReconcileStateOf(result, orderId)` → `reconciled | discrepancy | unknown` — для карточки заказа
  (TASK-222/223, решение `accounting_reconcile_order_state_api`).

## Снимок строк заказов (ТЗ п.9, п.11, TASK-210)

- **Зачем:** старые продажи «Финучёта» считаются по цене СДЕЛКИ, а не по текущей цене карточки (решение
  `accounting_order_lines_sync`). Это же «история цен продажи» ТЗ п.9 и источник для карточки заказа (TASK-222/223).
- **Таблицы** (миграция 0015): `accounting_order_lines` — текущее состояние позиции, ключ
  `(marketplace, telegram_user_id, order_id, item_id)`; `accounting_order_line_versions` — полная копия значимых
  полей на каждую версию (только дописывается); `accounting_order_sync_state` — строка на (продавец, площадка):
  последняя попытка, последний **успех**, `cursor_at` (верх окна последнего успеха), ошибка.
- **Поля** (копейки за единицу, неизвестное — null): цена продавца `item.price`, платёж покупателя `buyerPrice`,
  цена до скидок, субсидии площадки (Σ `item.subsidies` без DELIVERY — на единицу), скидка продавца
  = (цена до скидок − платёж) − Σ `promos.subsidy`, не ниже 0; выручка позиции = (платёж + субсидии) × кол-во —
  та же семантика, что `orderTotals().sales` (пиннится тестом). Даты: оформление, выкуп (факт доставки / день
  обновления выкупленного), доставка (план), возврат (день обновления вернувшегося). Статус, подстатус, источник.
  `campaign_id` — служебный, продавцу не показывается.
- **Версии:** отпечаток (sha1 значимых полей); совпал — только `last_seen_at`, иначе `version + 1` и строка версии.
  Пачка — одна транзакция под `FOR UPDATE`.
- **Опрос:** очередь `accounting-orders`, один `@Process` (concurrency 1), задача `accorders-<uid>` раз в
  `FIN_ACCOUNTING_ORDERS_EVERY_MINUTES` (умолч. 15, сдвиг минуты от хэша id). Кому — одобрен + `fin_accounting` +
  настроенный ЯМ, **без админов**. Payload — только `telegramUserId`, токен из Mongo. Все магазины кабинета
  (тот же business_id, правило `campaignClients` сверки), живой `GET /campaigns/{id}/orders` с `updatedAtFrom/To`:
  первый раз — 7 дней, дальше — от `cursor_at` с нахлёстом 30 мин, не старше 29 дней. Повторы 420/429 — в клиенте.
- **Ошибки:** сбой пишет `failed` в состояние (успех и курсор прежние — следующий опрос возьмёт то же окно) и
  пробрасывается в `@OnQueueFailed` → `ErrorReporter`. Магазин не настроен — `not-connected`, без исключения.
- **Ручной прогон:** `scripts/sync-accounting-orders.ts --user=<id> [--marketplace=ym|ozon|wb|all] [--days=7]
[--from-cursor]`.

### Ozon и WB (TASK-211, решение `accounting_order_lines_ozon_wb`)

- **Откуда:** возможность реестра `orderLines.rawOrderLines(ref, window)` — сырьё площадки, разбор здесь
  (`ozonOrderLines`, `wbOrderLine`). Клиенты Ozon/WB «Финучёт» не импортирует (README marketplaces).
- **Ozon:** `/v4/posting/fbs/list` и `/v3/posting/fbo/list` с `with.financial_data`, строка на товар, ключ
  `(posting_number, sku)`. Цена продавца `financial_data.price`, цена покупателя `customer_price`, к признанию дохода
  `revenue_kopecks` = цена продавца × кол-во (как `commission.sale_amount` журнала), субсидия площадки = цена продавца
  − цена покупателя (скидки «за счёт Озон»), выплата `payout`, комиссия `commission.amount`. **0 в выплате и комиссии
  — null:** до доставки Ozon шлёт нули (живой ответ), это «не посчитано», а не ноль рублей. Дат выкупа и возврата в
  отправлении нет — null. Окно — всегда последние 29 дней по `in_process_at`: фильтр Ozon не по дате обновления, и
  окно от курсора не увидело бы смену статуса старого отправления.
- **WB:** supplier/orders и supplier/sales «Статистики» от `dateFrom` (дата ИЗМЕНЕНИЯ) — окно от курсора, как у ЯМ.
  Строка на `srid` (штука; тот же номер, что `order_id` журнала WB), `count` = 1. Цена продавца `priceWithDisc`,
  покупателя `finishedPrice`, до скидок `totalPrice`, субсидия = СПП (`priceWithDisc − finishedPrice`), к признанию
  = `priceWithDisc` (как `retail_price_withdisc_rub` журнала). Выкуп S — день выкупа и `forPay`, возврат R — день
  возврата и окончателен. Продажа без заказа в окне ложится поверх сохранённой строки (`currentValues`).
- **Частота:** опрос ставится раз в 15 минут, но Ozon и WB — не чаще раза в час (`ORDER_LINES_MIN_INTERVAL_MS` по
  `last_attempt_at`): проход WB — ≥ 2 × 61 с выдержки «Статистики» на токен, общей с «Передачей остатков».
- **Независимость:** площадки идут по очереди, каждая в своём `try`; сбой одной пишет `failed` в её состояние, остальные
  пишутся, после прохода бросается `AccountingOrdersSyncError` (её видит `@OnQueueFailed`). Кому — те же правила, что у
  частой загрузки: `pickAccountingMarketplaces` (Ozon/WB — фича площадки + ключ `connectedUsers`), без админов.
- **Отпечаток:** `payout_kopecks`/`commission_kopecks` (миграция 0016) входят в отпечаток только не-null — иначе каждая
  строка ЯМ, записанная до них, получила бы лишнюю версию. Пиннится тестом.

## История закупа v2 (ТЗ п.2, режим А, TASK-213)

- **Свои таблицы** `accounting_cost_records` + журнал `accounting_cost_record_changes` (миграция 0017, решение
  `accounting_cost_history_v2`). Текущая `CostHistory` (Mongo), `costAt`/`costOn` и `cogsOf` не меняются и v2 не
  читают — числа текущей «Прибыли» и P&L не двигаются по построению.
- **Начало — момент** (timestamptz), не московский день: две загрузки прайса за день с разной ценой — две записи, продажа
  между ними получает закуп первой. `productId` — id `Product` строкой, без FK; закуп — `IProductPurchase` в jsonb
  (цены в валюте дробные).
- **Строго** (`accounting_unknown_cost_strict`): `accountingCostAt(records, moment)` — последняя запись с
  `validFrom ≤ moment`; нет — `unknown` («Неизвестная закупка», `UNKNOWN_COST_LABEL`). Ни неявной стартовой, ни
  `PurchasePrice`/`Product.purchase`. Себестоимость в копейках — `accountingUnitCost` через ту же `productCost`
  (скидка бренда, курс, доп. расходы); валюта без курса — `unconvertible`, тоже неизвестно.
- **Запись прайсом** — `StockSyncService.saveAccountingCostHistory` сразу после текущей истории; пишет ТОЛЬКО изменения
  (`priceListCostWrites`): нет записи у товара — это изменение, тот же прайс — ноль записей. Доп. расходы действующей
  записи переносятся, ручная запись не переписывается файлом с той же ценой (как `product_manual_vs_price_list`).
  Сбой не роняет загрузку — `ErrorReporter`, context `accounting:cost-history`.
- **Исправление прошлой цены** — `AccountingCostHistoryService.correct`: момент не в будущем, закуп по
  `validateManualPurchase`, причина обязательна. Запись ровно на момент есть — её закуп переписывается
  (`source: 'manual'`), нет — заводится новая; было/стало/автор/админ-за-продавца/причина — в журнал, в одной
  транзакции. Совпадает — ничего. Строки не удаляются никогда.
- **Старт** — `scripts/backfill-accounting-cost-history.ts --user=<id> [--apply]`: датированные записи `CostHistory` →
  00:00 МСК их дня (`source: 'cost-history'`), стартовая `validFrom: null` не переносится; повтор безопасен.
- **CRM** (под `fin_accounting`): `GET crm/ym/accounting/cost-history/:productId` — записи и журнал;
  `POST …/:productId/corrections` `{ validFrom, price, currency?, rate?, extraCosts?, reason }` → 400
  `INVALID_COST_CORRECTION` с `field`, чужой товар — 404 `COST_PRODUCT_NOT_FOUND`. Автор — из токена. Поиск товара —
  `GET …/cost-history/products?q=` под тем же зонтиком (TASK-235, решение `accounting_cost_history_product_search`):
  «Товары» закрыты своей фичей, а «Финучёт» от неё не зависит. Экран — секция «История закупа» раздела (TASK-235);
  правка строки шлёт точный момент записи, иначе минутное поле формы завело бы соседнюю запись.
- **Модуль** — свой `AccountingCostHistoryModule` (Database + Postgres): его импортирует `YandexModule` (загрузка прайса),
  а `AccountingModule` сам импортирует `YandexModule`, провайдер там дал бы цикл; `AccountingModule` его реэкспортирует.

## Партии (режим Б, часть 1, ТЗ п.2, TASK-214)

- **Таблица `accounting_lots`** (миграция 0022, решение `accounting_lots_storage`): строка закупки «Закупок» → партия —
  `product_id` (товар Mongo строкой, null — артикул не сопоставлен), `sku`, `count`, `remaining`, `unit_price_kopecks`,
  `extra_kopecks` (доля доп. расходов на ВСЮ строку), `received_day` (пока = день оплаты закупки). FK на
  `finance_purchases` с каскадом.
- **Доп. расходы — свои поля закупки** `delivery_kopecks`, `other_costs_kopecks`, `lot_cost_split` (`value` — по стоимости
  строки, `count` — по штукам). В `amount_kopecks` и ДДС не входят: ДДС (`cashflow.ts`) суммирует только
  `amount_kopecks`, тест пиннит. Расходы > 0 без позиций — 400 под `lines`.
- **Разнесение** — `extraShares` (`accounting-lots.domain.ts`) через `splitKopecks`: наибольший остаток, Σ долей равна
  доставке с прочими до копейки; без расходов `splitKopecks` не зовётся. На штуки долю делит `extraForUnits`
  (накопленное округление) — любые порции FIFO в сумме дают ровно `extra_kopecks`.
- **Сохранение закупки пересоздаёт все её партии** (`FinancePurchasesService` → `AccountingLotRepository.replaceForPurchase`
  в одной транзакции с закупкой), остаток = количество; без позиций — партий нет. Артикул → товар —
  `ProductService.resolveForPriceList` (SKU ЯМ, потом внутренний), до транзакции, при каждом сохранении заново.
- **Фича `fin_accounting_lots`**: CRM показывает поля в форме закупки и принимает их только при ней (`lotsEnabled` в виде).
  Без фичи контроллер отбрасывает поля из тела — правка не обнулит доставку; партии из позиций пишутся всегда (данные,
  без экрана) — включив режим Б, продавец увидит и старые закупки.

## FIFO-списание и режим себестоимости (режим Б, часть 2, ТЗ п.2, TASK-215)

- **Режим продавца** — `accounting_cost_settings` (миграция 0023, решение `accounting_cost_mode_setting`):
  `historical_price` (А, закуп из прайса v2) | `lot_fifo` (Б, партии). Нет строки — А. `AccountingCostSettingsService`
  (`snapshot`/`set`/`methodOf`); действующий режим Б — только при открытой `fin_accounting_lots` (`methodOf(uid,
features)`), иначе А. Дверь одна — `AccountingCogsService.lotCostOf(uid, features)`: Б → резолвер партий, А →
  `undefined`; его зовут карточка/список заказов и налог (вычет «Доходы минус расходы»). CRM — `GET|POST
…/cost/settings` (`src/modules/crm/README.md`), переключатель — `LotsSection` в CRM (TASK-216).
- **`fifoAllocate`** (`accounting-lots.domain.ts`) — чистая функция, считается С НУЛЯ по всем партиям продавца
  (`listForUser`) и всем позициям заказов (`AccountingOrderLineRepository.allForUser`) всех площадок — склад один.
  `remaining` в базе не читается (решение `accounting_lots_storage`). События — (момент, продажа раньше возврата,
  ключ `площадка|заказ|позиция`): порядок входа на результат не влияет.
- **Остатки партий** (экран, TASK-216) — `fifoAllocateWithRemaining` (то же ядро; `fifoAllocate` — его обёртка):
  кроме себестоимости продаж отдаёт `lotId → штук в наличии` после всех событий (свежие + восстановленные возвратом).
  Партия без товара FIFO не участвует — остаток = количество. Вход собирает тот же `AccountingLotCostService.allocate`,
  что и для себестоимости: второй формулы остатка нет, и в базу остаток не пишется.
- **Продажа** (`fifoSaleOf`: позиция → продажа; отменённая — не продажа) берёт штуки самых ранних партий своего
  товара, поступивших не позже дня продажи (момент — `saleMomentOf`, конец дня оформления). Товар позиции —
  `findByJournalSkus` (как режим А), товар партии — `product_id` (`resolveForPriceList`): оба — `_id` одного `Product`.
  Цена штуки = цена партии + доля `extraForUnits`. Не хватило партий — доступное всё равно списывается (товар ушёл),
  продажа `no-lot` → «Неизвестная закупка», без отката на прайс или `PurchasePrice`.
- **Возврат** — концом дня `returnedOn`, без дня (Ozon) — моментом продажи. `fit` и `unknown` кладут взятые штуки
  обратно в их партии «пулом восстановленных» с их ценой — следующая продажа партии берёт их первыми по той же цене,
  поэтому Σ списаний партии = цена × штуки + `extra_kopecks` ровно. `damaged`/`lost` — в партию не возвращаются.
  Состояние — `accounting_order_lines.return_condition` (TASK-238); null (нет данных, Ozon/WB) = `unknown`, принимается
  пригодным (решение `accounting_lots_return_condition`).
- **Состояние возврата ЯМ** (`ymReturnConditions`, решение `accounting_return_condition_ym_mapping`): `syncYm` сначала
  обходит возвраты кампании, обновлённые в днях окна (`fromDate`/`toDate`), потом заказы. Экземпляр
  (`items[].instances[]`): статус `LOST`/`UTILIZED`/`PREPARED_FOR_UTILIZATION`/`EXPROPRIATED` → `lost` (к продавцу не
  вернётся); иначе `stockType` `FIT` → `fit`, `UNDEFINED`/`UNKNOWN`/нет → `unknown`, любой другой (DEFECT, EXPIRED,
  ANOMALY, …) → `damaged`; `CANCELLED` и мёртвая заявка (`returnStage` = dead) не считаются; позиция без instances —
  `unknown`. Позиция (заказ, артикул) с несколькими экземплярами/возвратами берёт **худшее** — порядок `lost`,
  `damaged`, `unknown`, `fit`: FIFO знает одно состояние на продажу, и вернуть брак в партию хуже, чем недооценить
  остаток. Ставится только вернувшейся позиции. Вернувшаяся строка без возврата в окне сохраняет прежнее состояние
  (`currentValues`) — иначе повторный опрос заказа стёр бы его; возврат обновился, а заказ нет — сохранённая строка
  переписывается с новым состоянием (новая версия). Строки ещё нет — состояние придёт со следующим обновлением
  возврата. Поле в `FINGERPRINT_OPTIONAL_KEYS`: null в отпечаток не входит, у строк до TASK-238 отпечаток прежний.
  **На живом FBS-магазине (2026-11-11) `stockType` не приходит ни у одного из 3191 экземпляра** — только `status`
  (`LOST` — 10). Поэтому брак FBS берётся из **причины покупателя** (`ymReasonDamaged`, TASK-241, решение владельца
  `accounting_return_condition_ym_reason`): `items[].decisions[].reasonType` `BAD_QUALITY`/`DAMAGE_DELIVERY`/
  `WRONG_ITEM` у любого решения позиции поднимает `unknown` → `damaged` (и позицию без instances). Пришедший
  `stockType` важнее (`FIT` остаётся `fit`), `lost` не перебивается; прочие причины (`DOES_NOT_FIT`, …) ничего не
  меняют. Довод: другого признака брака у FBS нет, а вернуть брак в партию хуже, чем недооценить остаток; это
  заявление покупателя, а не осмотр — часть «брака» на деле годна (отвергнуты ручная отметка продавца — нужны UI и
  хранилище — и «оставить unknown»). Проверка — `scripts/diagnose-returns.ts`, блоки «ЭКЗЕМПЛЯРЫ», «ПРИЧИНЫ
  ПОКУПАТЕЛЯ», «СОСТОЯНИЕ ДЛЯ «ФИНУЧЁТА»», `--instances` — построчно.
- **Результат заказа** (`orderResultOf({ lotCostOf })`): `cogs` — Σ живых позиций по партиям (возвраты и отмены не
  входят), у вернувшейся с неизвестным состоянием — `note: RETURN_ASSUMED_FIT_NOTE`; повреждённый/утраченный возврат
  — строка `cogs_write_off` «Списание возврата» (обязательная, если есть). `IOrderResult.costMethod` —
  `historical_price | lot_fifo | unknown` (unknown — себестоимость не определена). На карточке это `cogsMethod`
  (+ `cogsMethodTitle`): поле `costMethod` там исторически — методика распределения. Позиции себестоимости в Б —
  `totalKopecks` и `portions` (день поступления, штуки, сумма); цена штуки — только если все штуки стоят одинаково.
- **Налог в Б** — `taxCogsOf` получает себестоимость строки целиком (А — закуп × штуки), строка журнала → позиции
  того же заказа и артикула; штук в журнале меньше — доля одним округлением; возврат уменьшает расход, только если
  штуки вернулись в партию.

## Результат заказа (ТЗ п.4, п.7, п.14, TASK-217)

- **Ядро** — чистая `orderResultOf` (`order-result.ts`, без Nest и I/O): строки заказа (`accounting_order_lines`) +
  операции реестра заказа (журнал с развёрнутой расшифровкой, как `liveByOrderIds`, и ручные — `origin: 'manual'`) +
  себестоимость v2 через колбэк `costOf(line, moment)` + необязательные распределённые суммы. Сервис, который всё это
  читает (и ищет товар по offerId), — TASK-222.
- **Карточка** — строки `revenue, commission, acquiring, delivery, reverse_logistics, other_services, advertising,
advertising_allocated, opex_allocated, compensations, cogs, tax_allocated` (`ORDER_RESULT_TITLE`); статья журнала → строка —
  `ORDER_RESULT_KEY_OF_ARTICLE` (`Record` по всем статьям). У каждой — копейки со знаком журнала, источник
  `actual | expected | allocated | unknown`, id операций, у `allocated` — методика, у `expected`/`unknown` — причина.
- **Выручка продавца** = продажи + возвраты + субсидии площадки: скидка за счёт площадки выручку не уменьшает (приёмка
  №4), субсидия входит один раз. Компенсации и прочие начисления — своей строкой, не в выручку. `bonus_payment` —
  `referenceOperationIds`, вне суммы. Цены сделки (покупатель / продавец / признано / скидка площадки) — `prices`.
- **Без операций:** выручка — `expected` из `revenueKopecks` живых строк; комиссия — `expected` только из поля площадки
  (Ozon `commissionKopecks × count`), никогда не процент, иначе `unknown`; логистика — `unknown`; прочие строки —
  фактический 0 (их отсутствие — нормальный случай).
- **Себестоимость:** момент продажи — `saleMomentOf` = конец московского дня `createdOn` (нет — `soldOn`), решение
  `accounting_order_result_sale_moment`. Вернувшиеся и отменённые строки закупа не несут.
- **Чистая прибыль** = Σ строк карточки (целые копейки — расхождения округления нет). Неизвестна обязательная строка
  (выручка, комиссия, логистика, себестоимость) — `null` с `unknown: { key, reason }`, не 0. Источник итога — `expected`,
  если есть ожидаемое, иначе `allocated`, если есть распределённое, иначе `actual`; `bySource` — суммы по источникам
  (для разделения факта и ожидаемого в TASK-218).
- **Распределённое** — только переданное вызывающим (`allocations.advertising` / `opex` / `tax`, методики TASK-219/221);
  не передано — строки нет вовсе (`accounting_allocated_is_labeled`).

## Результат возвращённого заказа (ТЗ п.3, TASK-224)

- **Ядро** — чистая `returnResultOf` (`return-result.ts`): те же строки заказа и операции реестра, что у
  `orderResultOf`, + `lotCostOf` (режим Б) + доли расходов продавца на заказ (`expenses`, TASK-220). Раздел — ниже.
- **Только операции этого заказа** за все даты (`op.orderId === orderId`); строки возвратов без номера заказа — уровень
  магазина (общие расходы), в результат заказа не входят.
- **Строки** (`RETURN_RESULT_TITLE`): продажа и возврат платежа, логистика до покупателя, обратная логистика, обработка
  возврата, хранение возврата, комиссия, эквайринг, удержания/штрафы/прочее, компенсации, списание товара, повторная
  упаковка. Классификация: подстатья `reverse_logistics | return_processing | return_storage` → своя строка, иначе
  статья (`RETURN_RESULT_KEY_OF_ARTICLE`, `Record` по всем статьям); `bonus_payment`/`promotion_report` — справочно.
- **Отдельно:** `logisticsKopecks` = туда + обратно + обработка + хранение возврата; `commission`/`acquiring` —
  удержано (−) / возвращено (+) / нетто = невозвращённое. Итог `resultKopecks` = Σ строк, знак журнала (приёмка №3:
  −150 −180 −50 = −380, компенсация +50 → −330).
- **Себестоимость:** пригодный и неизвестного состояния возврат восстанавливает партию — не потеря (у неизвестного —
  строка списания 0 с `RETURN_ASSUMED_FIT_NOTE`); повреждённый/утраченный в режиме Б — `cogs_write_off` через общую с
  карточкой `writeOffOfLotLines`; неизвестная себестоимость списания → итог `null` с `unknown`. Режим А — списания нет.
- **Повторная доставка/перемещение** отдельной подстатьи нет ни у одной площадки — идут в «Логистику до покупателя».
- `returnLossesOf` и «Аналитика возвратов» не меняются (`accounting_beside_current`).

## Раздел «Возвраты» (ТЗ п.3, TASK-225)

- `AccountingReturnsService.month` → `orderCards.periodOrders` месяца оформления (снимки пишутся, как у списка) →
  `returnsSummaryOf` (`accounting-returns.domain.ts`). Вход каждого возврата — `returnOfOrder`: те же поля карточки +
  повторная упаковка = доли «Прочих расходов» карточки с `method === ORDER_EXPENSE_METHOD` (расходы со scope «заказ»).
  `scripts/diagnose-accounting.ts --section=returns` зовёт тот же `returnOfOrder` — числа экрана и скрипта равны.
- По площадке: заказы (ушедшие покупателю — отменённые до продажи не считаются), возвращённые, доля, выручка
  вернувшихся позиций, логистика туда, обратная (+ обработка и хранение возврата), удержания (нетто комиссии и
  эквайринга + прочее), компенсации, списание, упаковка, итог = Σ `resultKopecks`. Хоть один `null` → итог `null` +
  `unknownCount`. Площадки — только колонками, общего итога нет.
- Модели — топ `RETURNS_TOP_MODELS` по вернувшимся штукам с долей от ушедших; убытка по модели нет.
- ЯМ без магазина в URL не показывается (как панель).

## Состояние прибыли и снимки (ТЗ п.5, TASK-218)

- **Надстройка** над `orderResultOf`, правила карточки не меняются: чистая `orderProfitStateOf` (`order-profit-state.ts`)
  — карточка + строки заказа + `orderReconcileStateOf` месяца (null — не сверялся) + необязательный прогноз
  `forecastOf(line)`. Решение `accounting_order_profit_state`.
- **Состояния:** нет ни одной операции реестра (у всех сумм пустые `operationIds`) — `forecast`; месяц сверен и все суммы
  `actual`/`allocated` — `reconciled` (`final: true`); иначе — `preliminary` (операции есть, но месяц не сверен,
  `discrepancy` или в карточке осталось ожидаемое/неизвестное). Подписи — `ORDER_PROFIT_STATE_TITLE` / `…_HINT`, один
  текст для CRM и бота.
- **Прогноз** — средние ставки «Калькулятора цен» за 30 дней (`PriceCalcRatesService.forSku` → `orderForecastRatesOf`):
  это факт P&L окна, не тарифы, поэтому сумма — `expected` с `reason: 'forecast'` и `basis`. Считается той же
  `profitAt` (`src/shared/price-calc.ts`) по живым позициям. Заполняет только комиссию и логистику, которых в карточке
  нет совсем (`unknown` / `no-operations`); фактическое и `expected` из полей заказа (комиссия Ozon) не трогаются. Нет
  ставок у какой-то позиции — строка остаётся `unknown`, прибыль `null`.
- **Разделение:** `confirmedKopecks` = Σ actual + allocated; `expectedKopecks` = Σ expected — отдельно, в подтверждённое
  не входит никогда; `netKopecks` = их сумма или `null` с `unknown {key, reason}`.
- **Снимки** (миграция 0018): `accounting_order_results` — голова на (площадка, продавец, заказ) с состоянием и тремя
  суммами; `accounting_order_result_versions` — полная карточка (`IOrderProfit`) и причина на каждую версию, только
  дописывается. `AccountingOrderResultRepository.recordSnapshot` — под `FOR UPDATE`, версия только при смене
  `orderProfitFingerprint`; причина — `snapshotReasonOf`: `first` → `recalculated` → `reconciled`, любая смена после
  сверенной — `correction` (поздняя корректировка), сверенная версия остаётся в истории. Кто зовёт пересчёт и запись —
  сервис карточки (TASK-222).

## Распределение общих расходов (ТЗ п.7, п.8, TASK-219)

- **Ядро** — чистая `allocateStoreCosts` (`store-cost-allocation.ts`): методика + заказы периода (`orderId`, выручка
  продавца, штуки) + общие расходы (`IStoreCostItem`: операция без заказа или налог периода) → `byOrder`
  (`IOrderAllocations` — прямо вход `orderResultOf`), Σ распределённого по виду, нераспределённое списком с суммой,
  итог периода. Кто собирает вход и зовёт — сервис карточки TASK-222, налог периода — TASK-221.
- **Методика** — одна на продавца для всех видов (решение `accounting_allocation_method`): `none` («Не распределять»),
  `revenue_share` («Пропорционально выручке», умолчание), `units_share` («Пропорционально штукам»). Хранится в
  `accounting_allocation_settings` (миграция 0019, PK продавец, нет строки — умолчание), читает и пишет
  `AccountingAllocationSettingsService` (`snapshot` / `methodOf` / `set`). Экрана выбора пока нет.
- **Виды** — `storeCostKindOf(article)`: `promotion` → `advertising` (слот «Реклама (распределено)»), прочие расходы и
  нераспознанное → `opex` («Общие расходы (распределено)»), доходы и справочное → `null`. Налог — `kind: 'tax'` от
  вызывающего. Отбор «уровня магазина» — тот же, что у сверки (`accounting-reconcile.domain.ts`: деньги, без `orderId`,
  журнал + ручные).
- **Копейки:** сумма вида делится одним `splitKopecks` (`finance/pnl-sku.ts`, наибольший остаток) по весам — только
  положительная выручка или штуки; Σ по заказам = исходная сумма до копейки, знак сохраняется. Заказ с нулевой долей
  строки не получает. Каждая доля несёт `method` — название методики.
- **Нераспределённое не теряется:** `method-none` (методика «не распределять»), `no-base` (нет заказов с выручкой или
  штуками — отсекается до `splitKopecks`, который бросает при Σ весов ≤ 0), `not-a-cost` (доход без заказа).
  allocated + unallocated = итог периода при любой методике.
- **Распределённое не фактическое:** оно только в `*_allocated`, фактическая `advertising` заказа — его собственные
  операции (`accounting_allocated_is_labeled`).

## Налог нового учёта (ТЗ п.6, TASK-221)

- **Своей формулы нет.** Налог периода — тот же `taxOf` (`finance/tax.ts`), год с авансами, уменьшением на взносы и
  уплаченным — тот же `taxYearOf` (`finance/tax-year.ts`); различается только вход. Ядро — чистые функции
  `accounting-tax.ts`, чтение — `AccountingTaxService`. Текущий налог P&L и «Налогов» отсюда не зовётся и не меняется:
  `taxOf` получил необязательный набор облагаемых статей с умолчанием `TAX_BASE_ARTICLES`, остальные вызовы не тронуты.
- **Площадки:** все, что `AccountingService.marketplacesOf` (ЯМ с кредами, Ozon/WB подключены и открыты фичами), —
  налог по аккаунту (`accounting_tax_all_marketplaces`). Ручные операции — тех же площадок.
- **Правило агентской базы** — настройка продавца (`accounting_tax_settings`, миграция 0020,
  `AccountingTaxSettingsService`; нет строки — умолчание): `gross` (умолчание, `accounting_tax_base_gross`) — вся сумма
  от покупателя, ровно `TAX_BASE_ARTICLES` P&L; `net` — плюс расходы площадки (группа `expense`) со своим знаком, то есть
  сумма к перечислению. Нераспознанное и баллы не облагаются ни при каком правиле.
- **Состав базы** (`composition`, Σ = доход `taxOf`, у каждой строки `operationIds`): продажи, возвраты покупателям,
  корректировки базы, субсидии, компенсации, прочие начисления, удержания площадки (только `net`). Корректировка — строка
  журнала с подстатьёй `sale_correction`/`storno` и любая ручная операция дохода. Плюс разрез по площадкам.
- **Даты:** ручная операция — свой день начисления и для поступления, и для реализации (другой даты у неё нет).
  Строка Ozon/WB без `paidAt` при признании «по поступлению» берёт день начисления (`JOURNAL_HAS_PAID_AT`) и считается в
  `paidDayFallbackLines` с пометкой `PAID_DAY_FALLBACK_NOTE`; строка ЯМ без выплаты остаётся без даты (деньги не пришли),
  её id — в `undatedOperationIds`.
- **Вычеты «Доходы минус расходы»** (`accounting_tax_deductible_v2`): услуги площадки из журнала + ручные расходы + опер.
  расходы (`FinanceExpensesService.allocatedFor`) + себестоимость v2. При `net` услуги и ручные расходы не вычитаются —
  они уже уменьшили доход. Себестоимость — `AccountingCogsService.cogsOf`: строка журнала, двигающая товар →
  момент продажи `saleMomentOf` по строкам заказа → товар `findByJournalSkus` → `accountingUnitCost`; чего-то нет —
  строка не вычитается и попадает в `unknownCogs` (не 0). Сервис общий — его же возьмёт карточка TASK-222.
- **Начислено и уплачено:** год — `reportingPeriodsOf` (Q1, полугодие, 9 месяцев, год нарастающим итогом), налог
  «Финучёта» каждого периода → `taxYearOf` с уменьшениями (`finance_tax_reductions`) и уплатами
  (`finance_tax_payments`): `dueKopecks`/`advanceKopecks` — начисленный, `paidKopecks` — уплаченный, `balanceKopecks` —
  остаток. Журнал читается один раз на окно с 1 января, периоды — по очереди.
- **Налог на заказ** — `orderTaxItemOf(tax)` → `IStoreCostItem` `kind: 'tax'` → `allocateStoreCosts` по методике
  продавца → `tax_allocated` карточки с `method` и `note: ORDER_TAX_ESTIMATE_NOTE` («Оценка, не обязательство»).
  Налог периода остаётся своей строкой; при методике «не распределять» — в нераспределённом. Зовёт сервис карточки
  (TASK-222) через `AccountingTaxService.orderTaxItem`.
- **CRM:** `GET|POST crm/ym/accounting/tax/settings`, kind `accounting:tax-year` (журнал всех площадок за год — фоновая
  задача, как `taxes:year`). Экрана пока нет.

## Карточка и список заказов (ТЗ п.4–п.7, TASK-222)

`AccountingOrderCardService` (`accounting-order-card.service.ts`, чистая часть — `accounting-order-card.domain.ts`)
собирает вход и зовёт `orderResultOf` → `orderProfitStateOf` → `AccountingOrderResultRepository.recordSnapshot`.
Своих формул в нём нет.

- **Месяц** — календарный московский месяц оформления заказа (`createdOn`). По нему распределяются реклама, общие
  расходы и налог (решение `accounting_order_card_month`), поэтому сумма заказа в карточке и в списке одна и та же
  и не зависит от фильтра. Список берёт ровно один месяц `ГГГГ-ММ`.
- **База распределения** — заказы месяца всего аккаунта (`linesCreatedBetween`). Веса берутся из строк заказа:
  выручка или штуки живых позиций. Реклама и общие расходы площадки (`liveStoreLevelBetween` и ручные без заказа)
  делятся по заказам этой площадки, налог периода (`orderTaxItem`) — по заказам всех площадок
  (`accounting_order_card_base`). Магазин из URL только сужает выдачу ЯМ (`campaignId` строки), база от него не
  меняется.
- **Закуп** — `AccountingCogsService.unitCostResolver` по `offerId` строки. Это та же дверь, что у налога.
- **Прогноз** — только ЯМ: один `PriceCalcRatesService.build` на задачу; товар без продаж в окне получает средние
  аккаунта (`accounting_order_card_forecast_ym`). **Сверка** — `AccountingReconcileService.reconcile` месяца один раз
  на площадку и `orderReconcileStateOf`: ЯМ — по актам, Ozon — сверка v2 по сальдо месяца Ozon (TASK-227, тем же
  `reconcile(…, 'ozon')`); WB — `unknown` без вызова сверки — документа у WB нет, итог всегда `insufficient_data`,
  запрос в базу был бы лишним (TASK-236).
- **Расходы продавца (TASK-220)** — из «Расходов» (`finance_expenses`) через `AccountingStoreCostsService.expensesOf`
  (он же отдаёт методику — вход распределения из одной двери). Доля месяца — `expenseShare` P&L, у расхода заказа —
  вся сумма. Площадка — в общие расходы своей площадки; весь бизнес и записи до v2 — отдельным `allocateStoreCosts`
  по заказам всех площадок, как налог; оба — в `opex_allocated` (`mergeAllocations` складывает один вид).
  Заказ и товар — `allocateBoundExpenses` (`expense-binding-allocation.ts`) → строка `other_expenses` «Прочие
  расходы» (`allocated`, методика «Расход заказа» / «По штукам товара», `expenses` — каждая запись с категорией).
  Товар делится `splitKopecks` по штукам артикула среди заказов месяца; нет штук — `no-base` в нераспределённое.
  Расход заказа другого месяца в этом месяце не считается вовсе.
- **Раскрытие:** у каждой суммы есть `operations` — id, название услуги, часть суммы, день начисления, площадка,
  `documentId` (журнал — `last_document_id` через `byIds`, ручная — номер документа из формы) и `origin`. Σ частей =
  сумма строки, потому что раскрываются те же части расшифровки, что сложило ядро. Себестоимость раскрывается по
  позициям (`costLines`: закуп единицы, момент записи v2 или причина). У распределённого есть методика и месяц,
  у прогноза — `basis`.
- Снимок пишут и карточка, и список. Отпечаток не сменился — версия не пишется.
- **CRM:** kind-ы `accounting:order` (`{ marketplace, orderId }`) и `accounting:orders` (`{ month, marketplace?,
state?, lossOnly? }`) под `fin_accounting` + `fin_accounting_orders`, scope `store`. Магазина ЯМ (`campaign_id`)
  в ответе нет. Экран — TASK-223.

## Панель (ТЗ п.13, TASK-229)

`AccountingDashboardService` (`accounting-dashboard.service.ts`, чистая часть — `accounting-dashboard.domain.ts`)
собирает «кирпичи» (`IDashboardItem`: строка панели, сумма или `null`, операции, заказ, артикул) и складывает их по
площадкам. Своих формул прибыли нет. Строки: выручка, возвраты, компенсации, себестоимость, комиссии, логистика,
прочие услуги площадки, реклама, налоги, опер. расходы; производные — валовая (выручка + возвраты + себестоимость),
чистая (Σ строк), рентабельность (чистая к выручке за вычетом возвратов); отдельно «к выплате» и «уже получено».

- **Базис обязателен** и подписан в ответе (`basisTitle`, `basisHint`), решение `accounting_dashboard_bases`:
  - **продажа** — заказы, оформленные в днях периода (`createdOn`), целиком, суммами их карточек:
    `AccountingOrderCardService.ordersCreatedIn` — `periodOrders` по каждому месяцу периода (та же база распределения,
    налог, снимки), общая с аналитикой.
    Ожидаемое (`expected`) входит в сумму и показано отдельно `expectedKopecks`;
  - **начисление** — журнал (`liveForPnl`, отбор по `accruedAt`: налоговые строки «по дню выплаты» отрезаны) и
    ручные операции периода; себестоимость — карточкой месяца оформления заказов, чья `sales` начислена в периоде;
    расходы — `expenseShare` за период; налог — `AccountingTaxService.period`;
  - **деньги** — строки выплат периода (`FinanceCashflowService.build` → `payoutArticles` → `byIds`), оплаты закупа
    вместо себестоимости, уплаченный налог, расходы по `expenseCashDays`. Ручных операций нет: у них нет дня оплаты.
- **Строки статей** — `dashboardLineOfArticle` выводится из `ORDER_RESULT_KEY_OF_ARTICLE` и
  `DASHBOARD_LINE_OF_RESULT_KEY` (`Record` по строкам карточки): панель и карточка не разойдутся. `returns` — своя
  строка «Возвраты» со знаком «−» во всех базисах (`accounting_dashboard_returns`); в базисе «продажа» сумма `revenue`
  карточки делится по статьям её операций, Σ двух строк = сумме карточки.
- **Площадки не смешиваются.** Блок на площадку; «Все площадки» (`ALL_MARKETPLACES_LABEL`) — только при двух и
  более площадках или строках уровня кабинета (`marketplace: null`: налог, закуп, расходы бизнеса и товара). Такие
  строки в блок площадки не входят — флаг `excludesAccountLevel`.
- **Магазин из URL:** заказы и журнал ЯМ — только заказов кампании магазина (строки заказа с её `campaignId`; без строк
  — операция остаётся); без магазина ЯМ на панели нет. Ozon/WB — без магазина, как у карточки.
- **Фильтры:** площадка; заказ; артикул и бренд (`brandOf` по названию позиции) — кирпичи товара или заказа, где он
  есть: сумма заказа не делится по товарам. При товарном фильтре строки без заказа/товара и кабинета выпадают
  (`filterNote`), «к выплате»/«получено» — `null`.
- **Раскрытие** (`drill`) — тот же расчёт, затем строка блока: операции через `operationViewsOf` (механизм
  карточки, `documentId` — `byIds`), суммы карточек без своих операций (себестоимость, распределённое, ожидаемое) —
  ссылкой на заказ, расходы/закуп/налог — записями. Потолок 500 строк, `…Total` — сколько всего.
- **Обновление:** `sync` — `AccountingService.syncStatus` (`asOf` — самое раннее `lastSuccessAt`, и по площадкам).
- **CRM:** kind-ы `accounting:dashboard` (`{ basis, period: {key, day?} | range: {from, to}, marketplace?, brand?,
offerId?, orderId? }`) и `accounting:dashboard-drill` (то же + `{ line, block: 'all' | площадка }`) под
  `fin_accounting` + `fin_accounting_dashboard`, scope `store`. Пресеты — сегодня, день (для «вчера»), неделя, месяц;
  «за всё время» отклоняется. Экран (TASK-231) — `AccountingDashboardSection`, шлёт всегда `range`
  (`src/modules/crm/README.md`, «Финучёт»).

## Аналитика (ТЗ п.13, TASK-230)

`AccountingAnalyticsService.period` (`accounting-analytics.service.ts`, чистая часть — `accounting-analytics.domain.ts`)
— заказы, оформленные в днях периода (`ordersCreatedIn`, тот же набор, что базис «продажа» панели). Числа — только
`result.net` / `result.amounts` карточки (`orderResultOf`) и `returnOfOrder` (`returnResultOf`); здесь суммы, средние
и сортировки. Неизвестное — `null` + `unknownCount`, не 0.

- **ТОП-100 товаров** (`productsOf`, обе стороны): Σ чистой прибыли **однотоварных** заказов модели (в неотменённых
  строках один `offerId`); многотоварные — `multiModelOrders`, модели с неизвестным заказом — `unknownModels`, в ТОПы
  не входят. Ключ модели — площадка + артикул.
- **Убыточные заказы** (`lossOrdersOf`): `net < 0`, самые убыточные первыми, 100 + `total`.
- **Модели с расходами на возвраты** (`returnModelsOf`): Σ `returnResultOf` возвратов, где вернулась одна модель, топ-20
  от самого дорогого; смешанные — `multiModelReturns`.
- **Средние комиссия и логистика** (`averageOf`): только заказы, где строка `commission` / `delivery` — `actual`;
  `avgKopecks` на заказ и `shareOfRevenue` к выручке тех же заказов, со знаком журнала.
- **Прибыль по дням** (`profitByDayOf`): по дню оформления, каждой площадки отдельно, все дни периода (пустой — 0 заказов).
- **Площадки рядом**: все три в порядке ЯМ, Ozon, WB; без данных — `{ insufficientData: true, reason }`: не подключена
  или фича закрыта (`marketplacesOf`), ЯМ без магазина в URL, реестр ни разу не загрузился (`syncStatus.lastSuccessAt`).
  Такая площадка не входит ни в один блок.
- **CRM:** kind `accounting:analytics` (`{ period: {key, day?} | range: {from, to} }`, разбор — общий с панелью
  `parseAccountingPeriodParams`) под `fin_accounting` + `fin_accounting_dashboard`: аналитика — часть главной (TASK-231),
  отдельной подфичи нет. Экран — `AccountingAnalyticsBlock` под панелью (TASK-231).

## Доводы и история решений

- **Почему резервная копия — ручной шаг, а не часть старта (TASK-233, 2026-11-11).** Миграции на старте нарочно не
  ждутся и не роняют приложение (урок `lazyConnection`): дамп перед ними задержал бы подъём бота на время копии всей
  базы и потребовал бы `pg_dump`/`mongodump` в образе приложения. Копия перед деплоем — минута руками, а отката у
  drizzle нет, поэтому шаг записан как обязательный в CLAUDE.md.
- **Почему сводные разделы ссылаются на матрицу, а не копируют её (TASK-233).** Матрица — результат разбора живых
  ответов с номерами строк кода; копия разошлась бы с ней при первой правке. Здесь — только то, что нужно для решения
  «что делать», остальное — ссылкой.

- **Почему товар получает только однотоварные заказы (TASK-230, 2026-11-11).** Результат есть только у заказа:
  комиссия, логистика и распределённое не делятся по позициям. Деление по выручке или разнесение по `sku` операций
  было бы своей формулой результата позиции рядом с ядром; полный результат заказа каждой его модели посчитал бы
  заказ несколько раз. Заказы из нескольких моделей честно показаны счётчиком (`accounting_analytics_models`).
- **Почему возвраты — по месяцу оформления, а не по дню возврата (TASK-225, 2026-11-11).** Результат возврата — Σ
  операций заказа за все даты, как у карточки; месяц оформления даёт тот же набор заказов, что список и
  `diagnose-accounting`, и знаменатель доли «от продаж» — заказы того же месяца. Возврат прошлого месяца виден в месяце
  своей продажи. Убыток по модели не считается: результат есть только у заказа, деление по моделям было бы своей
  формулой (`accounting_returns_screen`).
- **Почему базис — параметр, а не три колонки (TASK-229, 2026-11-10).** Каждый базис — свой расчёт (карточки месяцев,
  журнал, ДДС) по секунде и больше; продавец смотрит один, и подпись базиса рядом с числом объясняет, почему суммы
  разные. Себестоимость в «начислении» — заказов, чья продажа начислена в периоде, а в «деньгах» её заменяют оплаты
  закупа: иначе валовая прибыль одного базиса смешивала бы признание и платежи (`accounting_dashboard_bases`).
- **Почему возвраты — отдельная строка статьи `returns` (TASK-229).** Она есть во всех трёх базисах одинаково и
  входит в сумму; «Аналитика возвратов» и результат возврата (TASK-224) отвечают на другой вопрос и в итог не
  складываются (`accounting_dashboard_returns`).
- **Почему налог, закуп и расходы бизнеса — только в «Все площадки» (TASK-229).** Их не поделить по площадкам без
  методики; молча положить в блок одной площадки значило бы смешать площадки в одном числе.
- **Почему сервис отдельный, а не методы карточки (TASK-229).** Конструктор карточки уже на 10 параметрах
  (`max-params`); панель зовёт карточку через публичный `periodOrders`, не добавляя ей зависимостей. Снимки при этом
  пишутся только при смене отпечатка — как у списка заказов.

- **Почему результат возврата — своя функция, а не `returnLossesOf` (TASK-224, 2026-11-10).** «Аналитика возвратов»
  отвечает «во что обошлись возвраты периода» по дню начисления; здесь — один заказ за все даты, вместе с доставкой туда,
  списанием и упаковкой. Смысл невозвращённой комиссии совпадает (нетто по заказу,
  `returns_unreturned_commission_net_by_order`), но формулы разные по объёму — склейка поменяла бы числа текущего экрана.
- **Почему подстатья раньше статьи (TASK-224).** У Ozon обработка и хранение возврата лежат в статьях `processing` и
  `storage`: по статье они ушли бы в «прочие услуги», и стоимость логистики возврата была бы занижена.
- **Почему операции без номера заказа не берутся (TASK-224).** Их нельзя честно приписать одному заказу; они уже
  распределяются как общие расходы магазина — взять их ещё и сюда значило бы посчитать дважды.

- **Почему расход заказа/товара — своя строка, а не `opex_allocated` (TASK-220, 2026-11-10).** Общие расходы
  делятся методикой продавца, а расход заказа методики не имеет: упаковка этого заказа — его прямой расход. Слить их
  в одну строку значило бы показать «Пропорционально выручке» у суммы, которая не распределялась. Строка всё равно
  `allocated`: это запись продавца, а не операция площадки (`accounting_allocated_is_labeled`).
- **Почему методика и расходы — один провайдер (TASK-220).** Карточке нужны оба как вход распределения; отдельной
  зависимостью расходы дали бы конструктору 11 параметров (`max-params` 10), а склейка в сервисе карточки — второй
  разбор категорий рядом с `labelResolver`.

- **Почему у Ozon документ — сальдо, а не выплаты и не отчёт о реализации (TASK-227, 2026-11-09).** У строк Ozon нет
  поручения и акта: выплата — одна сумма за день, и `paidAt` строкам ставит FIFO по этой же сумме. Сверка выплат с ней
  сошлась бы по построению. Сальдо месяца — числа Ozon, которых журнал не порождает: `accrued` против Σ строк ловит
  потерянные и лишние начисления, `closing_balance` — ещё и расхождение по выплатам. Отчёт о реализации
  (`/v2/finance/realization`) отвергнут: новый запрос, а живых ключей нет — форму ответа проверить нечем.
- **Почему WB без документа (TASK-227).** «Сумма поручения» WB (`wbPayoutByReport`) — Σ строк того же отчёта
  реализации; баланс WB API отдаёт только текущий. Показать её «сверено» — выдать сверку с собой за проверку.
- **Почему ноль документов — «недостаточно данных» (TASK-227).** Правило TASK-226 («сверено, если нет расхождений там,
  где документ есть») при нуле таких статей давало бы «Сверено» у WB всегда. У ЯМ выплаты всегда с документом —
  правило его не задевает.
- **Почему доставка — поля закупки, а не часть её суммы (TASK-214, 2026-11-09).** Сумма закупки — деньги поставщику в
  ДДС; доставку продавец обычно платит отдельно (она уже в «Расходах» или в выплате перевозчику), и сложить её в
  `amount_kopecks` значило бы задвоить выбытие в ДДС и сломать «Σ позиций = сумме».
- **Почему правка пересоздаёт все партии (TASK-214).** FIFO TASK-215 по критерию пересчитывается с нуля, поэтому хранить
  «потраченность» партии как истину не нужно; частичное пересоздание оставило бы партии, расходящиеся с закупкой.
- **Почему FIFO считается с нуля на каждый запрос, а не хранит списания (TASK-215, 2026-11-10).** Партии закупки
  пересоздаются при каждом её сохранении, а строки заказов меняют статус задним числом (возврат через месяц):
  хранимые списания разошлись бы с закупками после первой правки. Пересчёт — чистая функция, детерминирован и
  идемпотентен; цена — один проход по истории продавца на запрос.
- **Почему недостача всё равно списывает доступное (TASK-215).** Товар физически ушёл со склада; если бы продажа
  без полной партии ничего не брала, следующая продажа получила бы чужие штуки и «известную» себестоимость не той
  партии. Неизвестной остаётся только сама продажа с недостачей.
- **Почему восстановленные штуки уходят по своей цене (TASK-215).** Если возврат просто откатывает счётчик партии,
  одна и та же доля доп. расходов (`extraForUnits` по индексу штуки) списывается дважды, и Σ по партии расходится
  с `extra_kopecks`. Пул восстановленных хранит порции с их суммой — Σ сходится до копейки (тест пиннит).
- **Почему возврат без состояния — пригоден (TASK-215, владелец 2026-11-10).** Состояния нет ни у одной площадки в
  наших данных; «неизвестно → прибыль null» обнулило бы прибыль почти всех заказов с возвратом в режиме Б, а
  «неизвестно → списание» занижало бы её молча. Пригоден — с видимой пометкой, источник — отдельной задачей.
- **Почему несопоставленный артикул — партия без товара, а не отказ (TASK-214).** Позиции закупок вводились справочно с
  TASK-122; отказ сломал бы привычный ввод. Партия хранит `sku`, товар ищется при следующем сохранении закупки.
