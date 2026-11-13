# Матрица доступности финансовых данных ЯМ / Ozon / WB (TASK-205)

> Вход для «Финучёта» (M29–M33): подробная классификация — TASK-207, загрузка файлов — TASK-209, частота
> синхронизации — TASK-212. Снимок кода на 2026-11-08. Текущий расчёт (журнал `finance_operations`, P&L,
> «Прибыль») не меняется — решение `accounting_beside_current`; здесь только «что есть и откуда».

Подробности и доводы — в README: [finance](../src/modules/finance/README.md),
[yandex](../src/modules/yandex/README.md), [ozon](../src/modules/ozon/README.md), [wb](../src/modules/wb/README.md).
Пути ниже — относительно корня репозитория; номера строк — на дату снимка.

## Легенда ячейки

| Значение | Смысл |
|---|---|
| **auto** | грузится сам: метод API → поле → куда в журнал (статья / колонка) |
| **auto·raw** | приходит автоматически, но лежит только в `raw` jsonb строки журнала, своей колонки нет |
| **file** | только из отчёта кабинета (ручная выгрузка); указан отчёт и где взять |
| **manual** | данных у площадки нет, вводит продавец |
| **нет** | площадка не даёт / мы не берём; что с этим делать — решает TASK-207 |

Названия отчётов кабинета в ячейках **file** даны по интерфейсу, вживую не сверялись (см. `docs/known-gaps.md`).

## Источники

| Площадка | Финансы (журнал) | Выплаты | Заказы (даты, позиции, сверка) |
|---|---|---|---|
| ЯМ | `POST /v2/reports/united-netting/generate` (JSON, весь кабинет, лист `transaction_date`) → `ym-journal.ts`; для сводной строки акта — `united-marketplace-services` → `ym-act-breakdown.ts`; ручная загрузка того же отчёта файлом — `ym-netting-file.ts` (TASK-114) | поля той же строки netting: `paymentStatus`, `bankOrderDate`, `bankOrderId`, `bankSum` (`ym-journal.ts:166-170`) | `getOrders` v2 + архив `POST /v2/campaigns/{id}/stats/orders` (`src/modules/marketplaces/ym-orders.ts`, `finance-reconcile.service.ts`) |
| Ozon | `/v1/finance/accrual/by-day` (по дню) + справочник `/v1/finance/accrual/types` → `ozon-journal.ts`, `ozon-articles.ts`. `/v3/finance/transaction/list` отключён 08.09.2026 (TASK-194), старые строки сохранили его типы | `/v1/finance/balance` по дню → FIFO-раскладка `ozon-payouts.ts` | `/v4/posting/fbs/list`, `/v3/posting/fbo/list` (`src/modules/ozon/ozon.client.ts`) — сверка; с `with.financial_data` — снимок строк заказов «Финучёта» (TASK-211: цена покупателя `customer_price`, продавца `price`, `payout`, `commission.amount`) |
| WB | `sales-reports/detailed`, `period: weekly` (`src/modules/wb/wb.client.ts:97, 520`) → `wb-journal.ts`, `wb-articles.ts` | поля строки отчёта: `create_dt`, `realizationreport_id` (`wb-journal.ts:71-74, 172-192`) | в финансы не подключены (сверки нет); supplier/orders + supplier/sales «Статистики» — снимок строк заказов «Финучёта» (TASK-211: `priceWithDisc`, `finishedPrice`, `totalPrice`, `forPay`, день выкупа/возврата) |

## Матрица: поля и статьи ТЗ п.1

Статьи журнала — 20 ключей `FinanceArticle` (`src/modules/finance/finance-articles.ts:17-37`).

### Реквизиты операции и заказа

| Поле ТЗ | ЯМ | Ozon | WB |
|---|---|---|---|
| Номер заказа | **auto**: netting `orderId` → `order_id` (`ym-journal.ts:149-175`). Пуст у сводной строки акта | **auto**: `unit_number` (= `posting_number`) → `order_id`, только категории `POSTING`/`ITEM` (`ozon-journal.ts:275, 309`); у сборов продавца номера нет | **auto**: `srid` → `order_id` (`wb-journal.ts:184`) — **номер единицы товара, не корзины** |
| Дата оформления | **auto** вне журнала: заказы `creationDate` (`ym-orders.ts:16-41`); в журнале нет | **auto** вне журнала: отправление `in_process_at` (`ozon.client.ts:217-218`); в журнале нет | **auto·raw**: `order_dt` |
| Дата продажи | **auto**: `transactionDate` строки «Платёж покупателя» → `accrued_at` (МСК) | **auto**: `date` начисления → `accrued_at` (`ozon-journal.ts:69-78, 292`) | **auto·raw**: `sale_dt`; в колонку идёт `rr_dt` → `accrued_at` (`wb-journal.ts:165-166`) |
| Дата доставки | **нет** отдельно: сверка берёт DELIVERED по дате обновления статуса, не хранит | **нет**: в отправлении даты выкупа нет (`finance/README.md:509-510`) | **нет** отдельно (ближайшее — `sale_dt` в `raw`) |
| Дата возврата | **auto**: `transactionDate` строки «Возврат платежа покупателя» | **auto**: `date` начисления с `sale_amount` < 0 (`POSTING_RETURN`) | **auto**: `rr_dt` строки с `doc_type_name` «Возврат» |
| Артикул / SKU | **auto**: `shopSku` → `sku` | **auto**: `products[].sku` / `item_fees.fees[].sku` → `offer_id` каталога → артикул ЯМ, иначе `offer_id` (`ozon-journal.ts:236-257`, `ozon-finance.service.ts:44-57`); при нескольких SKU — пусто | **auto**: `sa_name` → артикул ЯМ по справочнику, иначе `sa_name` (`wb-finance.service.ts:37-47`); `nm_id`, `barcode` — только `raw` |
| Количество | **auto·raw**: `count` (`pnl.ts:87-97`) | **auto** вычислимое: Σ `sale_amount / seller_price`, дробное → нет штук (`finance-operation.repository.ts:51-63`); не сверено вживую | **auto·raw**: `quantity` (`finance-operation.repository.ts:64`) |
| Id операции | **auto**: ключ дедупа из полей строки netting → `operation_key` (sha256) (`ym-journal.ts:22-29`) | **auto**: `accrual_id` + сумма → `operation_key` (`ozon-journal.ts:93-95`) | **auto**: `rrd_id` + сумма → `operation_key` (`wb-journal.ts:81-83`) |
| Дата операции | **auto**: `transactionDate` → `accrued_at`; `actDate` → `act_date` | **auto**: `date` → `accrued_at`; акта нет | **auto**: `rr_dt` → `accrued_at`; `date_from`/`date_to` отчёта — только `raw` |

### Деньги по статьям

| Статья ТЗ | ЯМ | Ozon | WB |
|---|---|---|---|
| Выручка | **auto**: «Начисление · Платёж покупателя» → `sales`; «Возврат · Возврат платежа покупателя» → `returns` (`ym-articles.ts:52-80`) | **auto**: `commission.sale_amount` > 0 → `sales`, < 0 → `returns` (`ozon-journal.ts:194-199`) — цена до баллов Ozon | **auto**: `retail_price_withdisc_rub` (до СПП) → `sales` / `returns` по `doc_type_name` (`wb-journal.ts:105-110`) |
| Комиссия | **auto**: «Удержание · Оплата услуг Маркета» / «Размещение товарных предложений» → `commission`; сторно «Скидка за лояльность», «Возврат за размещение…» (`ym-articles.ts:83-103`) | **auto**: `commission.commission` (итоговая, со скидками), тип `SaleCommission` → `commission` | **auto**, вычисляемая: остаток `ppvz_for_pay − выручка − эквайринг` → `commission`; `ppvz_sales_commission` не используется (только `raw`) |
| Эквайринг | **auto**: «Приём платежа», «Перевод платежа» → `acquiring` | **auto**: `Acquiring` → `acquiring` | **auto**: `acquiring_fee` → `acquiring` |
| Прямая логистика | **auto**: «Доставка покупателю», «Доставка (средняя миля)» → `delivery_to_buyer` (+ сторно «Возврат за доставку…») | **auto**: `LastMile*`, `Shipment`, `Logistic`, `B2CLogistics`, `DeliveryToHandoverPlace*`… → `delivery_to_buyer`; сборка/Drop-Off/Fulfillment → `processing` (`ozon-articles.ts:51-138`) | **auto**: `delivery_rub` при `return_amount = 0`, типы «Логистика», «Логистика сторно», «Коррекция логистики», «Возмещение издержек по перевозке…» → `delivery_to_buyer` |
| Обратная логистика | **auto**: «Доставка невыкупов и возвратов» → `reverse_logistics` (всегда ли с номером заказа — не проверено) | **auto**: `BackwardShipment`, `ReturnFlowLogistic`, `ClientReturn`, `Cancellation`, `PartialReturn`… → `reverse_logistics` | **auto**: `delivery_rub` при `return_amount > 0` → `reverse_logistics` (`wb-journal.ts:115-123`) |
| Обработка возврата | **auto** без заказа: лист `order_processing*` отчёта услуг → часть `processing` в `breakdown` сводной строки акта (`ym-act-breakdown.ts:36-49`) | **auto**, слито: `PickUpPointReturnAcceptance`, `PreparingToReturn`… → `reverse_logistics` (своей статьи нет) | **нет**: не выделяется |
| Хранение | **auto** без заказа: листы `export_from_warehouse`, `storage_of_returns` → часть `storage` сводной строки акта; хранение FBY в данных не встречалось | **auto**: `Placements`, `TemporaryPlacement*`, `ReturnStorageInTheWarehouse` → `storage` (+ утилизация `Disposal` → `storage`) | **auto**: `storage_fee` и тип «Хранение» → `storage` |
| Приёмка | **auto** без заказа: листы `reception_of_surplus`, `delivery_via_transit_warehouse` → часть `acceptance` | **auto**: `SupplyInbound`, `CrossDock`, `Replenishment`… → `acceptance` | **auto**: `acceptance`, тип «Платная приёмка» → `acceptance` |
| Реклама | **auto**: «Буст продаж, оплата за продажи» → `promotion` (по заказу); `pushes`, `cpm-boost` → часть `promotion` сводной строки акта | **auto**: `PayPerClick`, `Promotion`, `Marketing`, отзывы… → `promotion`; баллы и кешбэк (`PointsForReviews`, `PremiumCashback*`) тоже → `promotion` | **auto**, слито: в `deduction` → `withholdings` (тип продвижения — `bonus_type_name` только в `raw`). **file**: отчёт кабинета «Продвижение» |
| Участие в акциях | **auto**, справочно: «Списание · Скидка за участие в совместных акциях» → `bonus_payment` (не деньги, в прибыль не входит) | **нет** отдельно: скидка внутри `commission.commission`; `bonus`/`coinvestment` отправления выброшены (`ozon-journal.ts:177-178`) | **нет** отдельно: внутри остатка-«комиссии»; `supplier_promo`, `seller_promo_discount` — только `raw` |
| Штрафы | **нет правила**: ни одного сопоставления на `penalties`, штраф придёт в `unknown` + алерт (`ym-articles.ts:131-154`) | **auto**: `DefectRate`, `DefectFine*` → `penalties` | **auto**: `penalty`, типы «Штраф(ы)» → `penalties` |
| Компенсации | **auto**: «Утрата или порча…», «Утеря или порча отправления…», «Ненадлежащее оказание услуг» → `compensations` | **auto**: `Compensation`, `ItemCompensation`, `ClaimCommission`… → `compensations` | **auto**: `additional_payment` и типы «Компенсация ущерба», «…брака», «Возмещение за выдачу и возврат на ПВЗ»… → `compensations` |
| Субсидии | **auto**: «Баллы за скидку Маркета / Яндекс Плюс» → `subsidies`; их возврат → `returns` | **нет**: ни один тип не сопоставлен с `subsidies` | **нет** отдельно: «Компенсация скидки по программе лояльности» → `compensations`; `cashback_*`, `loyalty_discount` — только `raw` |
| Удержания | **auto**: «Возврат · Удержание выплаты за утерю…», «…Выплата расходов покупателю при возврате…» → `withholdings` | **нет** | **auto**: `deduction`, типы «Удержание(я)» → `withholdings` (с рекламой внутри) |
| Корректировки | **не статья**: новая версия отчёта → `superseded_at` у выпавших строк + `finance_corrections` (changed/removed) | **unknown**: `CorrectionCommission`, `RealizationReportCorrection`, `SetOff` намеренно не сопоставлены (`ozon-articles.ts:46-50`); пересчёт суммы → новая строка + «изменено» | **auto**, внутри товарных типов: «Корректная продажа/возврат», «Сторно…», «Коррекция продаж» → `sales`/`returns` |
| Прочие услуги | **auto** без заказа: сводная строка акта «Оплата услуг Маркета» без названия → `other_services` + `breakdown` (подписка → `subscription`, остаток → `unknown`) | **auto**: подписки → `subscription`, `Installment`, `EarlyPayment`, `Marking` → `paid_options`; `other_services` не ставится | **нет**: `other_services`, `paid_options`, `subscription` не ставятся; незнакомый тип → `unknown` |
| Выплаты | **auto**, поля строки: `bankOrderDate` → `paid_at`, `bankOrderId` → `bank_order_id`, `bankSum` → `bank_sum_kopecks`, `paymentStatus` → `payment_status` | **auto**, вычисленные: `/v1/finance/balance` → FIFO → `paid_at` = полночь МСК дня выплаты; `bank_order_id` нет (`ozon-finance.service.ts:141-188`) | **auto**: `create_dt` → `paid_at`, `realizationreport_id` → `bank_order_id`, Σ строк отчёта → `bank_sum_kopecks` (`wb-journal.ts:222-229`); совпадение `create_dt` с днём денег не проверено |

Выплата во всех трёх площадках — **поля строки, а не статья**.

## Чего нет в строке журнала

Колонки `finance_operations` — `src/database/postgres/finance.schema.ts:150-234`.

| Поле ТЗ | Сейчас | Откуда можно взять |
|---|---|---|
| Валюта | колонки нет, всё в копейках ₽ | все три площадки — рубли; явного поля в журнале нет ни у одной |
| Позиция заказа | колонки нет; одна строка = одна операция | ЯМ — позиции заказа (`offerId`, `count`, `price`, `ym-orders.ts`); Ozon — `posting.products[]` в `raw`; WB — строка уже по единице (`srid`) |
| Дата отчёта | колонки нет; есть `act_date` (ЯМ) | ЯМ — `actDate`; Ozon — нет; WB — `date_from`/`date_to`/`create_dt` в `raw` |
| Статус обработки | колонки нет (`payment_status` — статус выплаты ЯМ, не обработки) | своё поле Финучёта (TASK-207) |
| Количество | только `raw` | см. матрицу |
| Даты оформления / доставки / возврата | только `accrued_at` | ЯМ `creationDate` (заказы), Ozon `in_process_at` (отправления), WB `order_dt`/`sale_dt` (`raw`) |
| Схема (FBS/FBY/FBO) | `model`: ЯМ — есть, Ozon — `delivery_schema`, WB — **не ставится** | WB — из типа склада в `raw` (не исследовано) |

## Задержка появления и частота опроса

Общее расписание: ночной импорт 03:00–05:59 МСК (минута — от хэша id продавца,
`src/modules/telegram/queue/services/finance-schedule.ts:39-51`), каждую ночь текущий и прошлый месяц, по понедельникам ещё
позапрошлый (`finance-period.ts:140-147`); незакрытый месяц — по сегодня. Очередь `finance-import`: concurrency 1, attempts 1.
Порядок: ЯМ → Ozon → WB.

| | ЯМ | Ozon | WB |
|---|---|---|---|
| Задержка финансов | не установлена для дня; месяц дописывается актами и выплатами ещё **недели** после закрытия (`finance-period.ts:132-133`); генерация отчёта — до 10 мин | начисления дописываются задним числом **до ~3 дней**, прошлые сторнируются (`ozon/README.md:174-176`) | отчёт **еженедельный**, «формируется после недели» (`wb-journal.ts:68`); точная задержка не установлена |
| Лимит финансов | `generate` netting / services — **1 в минуту на кабинет**, 100 генераций в час; обёртка: пауза 65 с, 3 попытки (`finance-import.service.ts:116-142`); поллинг 5 с × 120 | публичного нет; 429 видели уже на **0,3 rps** — дни строго последовательно, ~30 запросов на месяц; лимит `balance` неизвестен, период ≤ 30 дней | «Статистика»: **1 в минуту** (базовый токен — 1 в 3 ч); отчёт реализации делит очередь `WbStatisticsPacer` с паузой 61 с (`wb-statistics-pacer.ts:8`); страница 100 000 строк, ≤ 50 страниц |
| Задержка заказов | `stats/orders` отстаёт до **40 мин** (`yandex-api.paths.ts:88`) | не установлена | не исследовано для финансов |
| Лимит заказов | часовые квоты: orders 10 000, returns 5 000 (`yandex-retry.ts:6-7`); страница ≤ 200 | 429 на метод и Client-Id, страница 100; ретраи 4 попытки 1/2/4 с | общий с «Статистикой» |
| Ручная загрузка (сейчас) | есть: файл netting (TASK-114, заголовки угаданы) | нет | файл «Продвижение» → справочная `promotion_report` (TASK-209, заголовки угаданы) |
| Сверка | акт ↔ отчёт услуг + заказы + выплаты | заказы (`ozonReconcileOrders`), без актов и поручений | **нет** (`RECONCILE_NOT_IMPLEMENTED`, `finance-import.service.ts:190-195`) — период WB никогда не «Проверено» |

Для TASK-212: опрашивать финансы чаще раза в сутки имеет смысл только у Ozon (дневной метод, начисления в течение
~3 дней); у ЯМ упор — в лимит 1 генерация/мин на кабинет; у WB чаще раза в неделю нового отчёта не будет.

## Противоречия и пробелы — вход для TASK-207

1. **В `finance-articles.ts` 20 статей, а не 21**, как записано при заведении задачи.
2. **Штрафы ЯМ не в `withholdings`.** Правила на `penalties` у ЯМ нет совсем: в дампе 09-2026 штрафов не было, и штраф
   придёт в `unknown`. `withholdings` у ЯМ — только два типа «Возврат · Удержание…/Выплата расходов покупателю…».
3. **Статьи «участие в акциях» нет.** ЯМ — `bonus_payment` (справочно, оплата бонусным балансом), Ozon — внутри
   `commission`, WB — внутри остатка-«комиссии».
4. **Субсидии и софинансирование Ozon** в `subsidies` не попадают: типа нет, `bonus`/`coinvestment` выброшены, выручка —
   цена до баллов (`docs/known-gaps.md`, раздел Ozon). Новый тип софинансирования упадёт в `unknown`.
5. **Баллы и кешбэк Ozon — расход `promotion`**, у ЯМ баллы — доход `subsidies`. Одно явление — разный знак смысла.
6. **Реклама WB — в `withholdings`** (`deduction` целиком), `promotion` у WB не ставится.
7. **Комиссия WB шире комиссии**: остаток от `ppvz_for_pay` содержит вознаграждение ПВЗ, СПП и софинансирование акций;
   `ppvz_sales_commission`/`ppvz_reward`/`ppvz_vw` не используются.
8. **Обработка возврата не выделена**: Ozon — в `reverse_logistics`, ЯМ — `processing` в сводной строке акта без заказа,
   WB — нет.
9. **Утилизация Ozon — в `storage`.**
10. **Корректировки — три разных механизма**: ЯМ — версии документа (`finance_corrections`), Ozon — `unknown` + новая
    строка при пересчёте, WB — товарные типы «Сторно/Коррекция» в `sales`/`returns`.
11. **`order_id` WB = `srid`** (единица товара), у ЯМ/Ozon — заказ/отправление. Агрегация «по заказу» у WB не та же.
12. **Строки ЯМ без номера заказа** (сводная строка акта ≈ 100 тыс. ₽/мес: подписка, пуши, CPM, хранение, обработка,
    приёмка) в заказы не распределяются, хотя в отчёте услуг у обработки и хранения возвратов номер заказа есть.
13. **`finance/README.md` пишет «`paidAt` у Ozon пуст»** (около строки 506), а с TASK-184 он ставится по FIFO; верно
    только то, что `bank_order_id` пуст. README не правился (вне scope задачи).
14. **WB «Возмещение за выдачу и возврат товаров на ПВЗ»** отнесено к доходу `compensations` без обоснования — знак
    под вопросом.
15. **WB `rebill_logistic_cost`** в сумму не входит; совпадает ли он с `delivery_rub` — не проверено.
16. **WB знаки**: знак берётся только из `doc_type_name` «Возврат»; если «Сторно…» уже отрицательные — двойной минус.
17. **`wb-articles.ts:2`** в комментарии называет старый метод `reportDetailByPeriod`, код вызывает `sales-reports/detailed`.
18. **Карта ЯМ снята с одного кабинета за один месяц** (09-2026, FBS): не видели DBS/Экспресс, штрафы, хранение FBY,
    рассрочку; «Списание» как оплата баллами выведено из равенства сумм.
19. **Ozon и WB финансы ни разу не грузились живым ключом** — все **auto**-ячейки этих площадок построены по
    спецификации и чужим фикстурам (`docs/known-gaps.md`).
20. **Нет схемы `model` у WB**, нет валюты, позиции, даты отчёта и статуса обработки ни у кого (раздел выше).
