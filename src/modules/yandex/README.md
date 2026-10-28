# 🛒 Модуль Yandex Market

Доступ к Partner API, отчёты по заказам, расчёт прибыли и запись остатков.

## 🏗️ Структура

```
yandex/
├── yandex-api.client.ts       клиент Partner API одного продавца
├── yandex-client.factory.ts   создаёт клиент по документу магазина
├── yandex-api.paths.ts        пути, версии методов, лимиты страниц
├── yandex-api.errors.ts       доменные ошибки: Auth, NotFound, RateLimit, BadRequest
├── yandex-retry.ts            повторы на 5xx, 420 и сетевые сбои
├── yandex-date-window.ts      окно истории в 30 дней
├── report-poll.ts             общий поллер асинхронных отчётов (generate → info → файл)
├── report-zip.ts              разбор ZIP финансовых отчётов (format=JSON)
├── report-generation.error.ts провал/таймаут генерации отчёта с ответом Маркета
├── reports/
│   ├── report-status-map.ts   ЕДИНСТВЕННЫЙ источник правды о статусах и фильтрах дат
│   ├── report-period.ts       периоды и параметры дат для API
│   ├── moscow-day.ts          московские сутки и календарная арифметика
│   ├── order-day.ts           московский день заказа из любой формы даты Маркета
│   ├── money.ts               денежные поля, субсидии, формат рублей
│   ├── order-reports.service.ts  отчёты о заказах поверх API (и сбор заказов для прибыли)
│   ├── stats-orders.ts        маппер архива stats/orders (deep_history)
│   ├── profit.ts              арифметика прибыли (чистый модуль)
│   ├── profit.service.ts      прибыль = заказы API + закуп и история себестоимости из Mongo
│   ├── profit-message.ts      текст отчёта о прибыли
│   ├── tariff-estimate.ts     арифметика калькулятора тарифов
│   ├── tariff-calc-message.ts текст «🧮 Калькулятора»
│   ├── tariff-quote*.ts       тариф одного товара для калькулятора цен CRM
│   ├── brands.ts, promo.ts    реестр брендов и скидок, комиссия за продвижение
│   ├── report-message.ts      текст отчётов о заказах
│   └── report-workbook.ts     выгрузки отчётов о заказах в .xlsx
├── stocks/
│   ├── price-list.parser.ts   разбор прайса поставщика (ЖИВОЙ парсер)
│   ├── sku-resolver.ts        наименование прайса → артикул каталога
│   ├── stock-sync.service.ts  сверка и запись остатков, сохранение закупа
│   ├── stock-upload-policy*.ts  ранний слой решения о загрузке (бот и CRM)
│   ├── stock-levels*.ts       чтение остатков по артикулам (CRM)
│   ├── placement.ts           правило «FBY только для чтения»
│   └── stock-report.ts        текст отчёта о загрузке
├── fby/, warehouses/          сводка FBY и обзор складов
├── quarantine/, feedback/, payments/, recommendations/, cards/, market-reports/
│                              экраны Partner API (бот и CRM)
├── settings/, stores/         настройки прибыли и магазины (общие с CRM)
├── products/                  заполнение базы товаров из каталога
├── api/                       автогенерированный клиент — МЁРТВЫЙ, не расширять
└── api-docs/openapi/          выгрузка спецификации Partner API
```

## 🔑 Клиент

`YandexApiClient` **не может быть синглтоном**: токен и идентификаторы принадлежат конкретному
продавцу, а сервис мультитенантный. Общий клиент с изменяемым заголовком означал бы, что при двух
параллельных отчётах запрос одного продавца уйдёт с токеном другого. Креды вмораживаются в экземпляр
при создании (`YandexClientFactory`), сеттера токена нет намеренно.

Что важно знать про запросы:

- **Заголовок `Api-Key`**, а не `Authorization: Bearer`. Второе Partner API не понимает — именно
  поэтому сгенерированный OpenAPI-клиент так и не заработал.
- **Версия метода обязательна и у каждого своя.** Они перечислены в `yandex-api.paths.ts` рядом со
  своими путями: `orders` — v2, `returns` — v2, `campaigns` — v2, `offer-mappings` — v2, `stocks` — v2,
  история глубже 30 дней — архив `stats/orders` v2 (прежний `v1/businesses/{id}/orders` оказался мифом,
  см. «Второй заход» ниже).
- **Массивы в query уходят повторяющимся параметром**: `status=A&status=B`. Это настроено на экземпляре
  axios (`paramsSerializer: { indexes: null }`) и не косметика: `status[]=A` Partner API молча
  игнорирует и возвращает заказы во всех статусах — за июль приходило 946 заказов вместо 389.
- **Не все статусы можно спрашивать** — `QUERYABLE_STATUSES`, подробности в «Profit» ниже.
- **Пагинация только через `pageToken` + `limit`**, `page`/`pageSize` объявлены устаревшими. У
  `iterateOrders` есть предохранитель `maxPages`: битый токен, указывающий сам на себя, иначе крутил бы
  запросы, пока не кончится квота. Обрыв обхода пишется в лог ошибкой — неполный отчёт не должен
  выглядеть полным.
- **Лимит страницы у методов разный**, и превышение — это 400, а не молчаливая обрезка: заказы 50,
  возвраты до 100, каталог 200.
- **`PUT` идёт БЕЗ повторов.** Для чтения повтор безопасен, для записи нет: Яндекс мог применить
  изменение и не успеть ответить. При ошибке честнее показать её в отчёте, чтобы продавец перезапустил
  загрузку осознанно.

## 📊 Отчёты

Статусы и фильтр даты каждого отчёта заданы в `report-status-map.ts`, а логика их только читает.
Поэтому «добавьте в „едет обратно“ ещё один подстатус» — правка одной строки в маппинге.

| Отчёт           | Статусы                                                                             | Фильтр даты                     |
| --------------- | ----------------------------------------------------------------------------------- | ------------------------------- |
| Уехало клиенту  | `DELIVERY`, `PICKUP`, `DELIVERED`; на «Всего» — срез «в пути»: `DELIVERY`, `PICKUP` | дата отгрузки в службу доставки |
| Выкуплено       | `DELIVERED`                                                                         | дата обновления заказа          |
| Едет обратно    | `DELIVERY`, `RETURNED`, `PARTIALLY_RETURNED` + возвратные подстатусы                | дата обновления                 |
| Едет до клиента | `DELIVERY`, `PICKUP`; на FBY плюс `PROCESSING`                                      | нет, это срез «что сейчас»      |
| Прибыль         | `DELIVERED` + оформленные за период                                                 | обновление + дата оформления    |
| Калькулятор     | оформленные (`PLACED_STATUSES`, без `CANCELLED`)                                    | дата оформления                 |

«Уехало клиенту» и его «Всего», FBY-добавка «Едет до клиента», «Продажи» продавца, «Едет обратно» и период «Всего» — в «Доводах» ниже.

Что легко испортить (ещё два пункта — исключающий `toDate` и окна по 30 дней — в «Profit» ниже):

- **Фильтр по статусу уходит в запрос, но `matchesDefinition` применяется поверх ответа.** Подстатус
  Partner API фильтровать не умеет вовсе, и без второй проверки в «едет обратно» попали бы все заказы в
  доставке.
- **Сутки считаются по Москве, а не по времени сервера.** Контейнер живёт в UTC, и с 21:00 до 00:00 МСК
  «сегодня» на сервере — это уже завтра в Москве: продавец в 22:30 получил бы пустой отчёт. Смещение
  берётся у `Intl` на конкретную дату, а не зашито числом. По той же причине время в подписи среза
  «едет до клиента» — `moscowClock`, а не `getHours()`.

Опрос ОДНОГО магазина. Если у токена их несколько, отчёт покрывает только выбранную кампанию — это
видно в диагностическом скрипте (`scripts/diagnose-orders.ts`).

### Период «Прошлый месяц»

`PERIOD.PREV_MONTH` — прошлый календарный месяц целиком, **только у «Прибыли»** (TASK-126): у журнала
Маркета «Проверено» бывает лишь у закрытого месяца. Кнопки — `periodsFor(reportKey, {prevMonth})`, открыт
при фичах `profit_actual` и `deep_history` (`isPrevMonthOpen`): начало месяца почти всегда старше 30 дней.
`parseReportCallback` не принимает его у других отчётов, в `SCHEDULE_PERIODS` его нет.

## 💰 Прибыль и калькулятор тарифов

Арифметика, источники закупа, скидки брендов и калькулятор тарифов — в «Profit» ниже.

## 📇 Каталог для базы товаров

- `loadCatalogProducts()` — полный обход offer-mappings по `page_token` (пустое тело, страница 200) со
  штрихкодами, `vendorCode`, `vendor`, названием и `basicPrice`. Только чтение. `getOfferMappings` для этого не
  годится: фильтр `offerIds` несовместим с пагинацией. Потребители — `ProductSeedService` (`products/`) и
  возможность `catalog` адаптера ЯМ (`marketplaces/ym-marketplace.adapter.ts`), правила
  базы товаров — `src/modules/products/README.md`.

## 📦 Остатки — запись в Partner API

Мутирующих операций в приложении четыре: этот PUT и три POST через `postWrite` клиента — подробности
в «Четыре экрана из Partner API» ниже.

`StockSyncService.sync(credentials, buffer, { telegramUserId, dryRun })`:

1. `parsePriceList` разбирает файл. Пустая ячейка количества означает «нет в наличии», то есть ноль:
   в текущем файле склада приходит весь ассортимент, а количество заполнено меньше чем у четверти
   позиций. Пороги «>N» превращаются в N+1, «<N» — в N−1: занижение безопаснее завышения. Нечитаемый
   мусор уходит в `invalid`, а не превращается в ноль молча — ноль это КОМАНДА обнулить остаток.
2. `loadCatalogOfferIds` читает каталог продавца: без него непонятно, какие артикулы существуют, а
   слать заведомо отсутствующие — это 400 на весь батч.
3. `resolveSku` сопоставляет наименование с артикулом каталога. Правило: отрезать бренд, хвост
   сохранить дословно. Перебираются три варианта — код без бренда, имя как в прайсе и с приставкой
   «Наручные часы», потому что каталог неоднороден.
4. Закупочные цены пишутся в нашу Mongo — в каких случаях и почему, см. «Profit» ниже.
5. Остатки уходят батчами по 500. Отказ одного батча не прерывает остальные: иначе ошибка на первой
   сотне позиций оставила бы остальные четыре тысячи необновлёнными, а пользователь увидел бы это как
   полный провал.

Параметры передаются объектом, а не позиционным флагом: пока третьим аргументом был `dryRun`, забытый
аргумент означал **боевую** запись остатков там, где просили только сверку. Сейчас `sync` без
`telegramUserId` просто бросает исключение.

### На FBY остатки только читаются

Правило и его обоснование живут в `stocks/placement.ts`; `isStockWritable` — единственное место, где
решается, можно ли писать.

| Модель                        | Где лежит товар | Остатки                                                |
| ----------------------------- | --------------- | ------------------------------------------------------ |
| FBS, DBS, Express             | склад продавца  | пишет продавец — для этого и загрузка прайса           |
| FBY                           | склад Маркета   | **только чтение**: количество меняют приёмка и продажи |
| неизвестная / не определилась | —               | **не пишем**                                           |

Без проверки запись уходила бы на склад Маркета. На боевом кабинете (business `164225008`)
FBY-кампания `148704883` отдаёт склад **147 «Ростов-на-Дону-1»** — он же в `GET v2/warehouses`,
списке фулфилмент-складов Маркета; FBS-кампании `148655119` и `124425371` отдают `1826207` и
`1519714`, настоящие склады магазина.

**Файл на FBY всё равно принимается — не пишутся только остатки.** Прайс единственный источник
закупочных цен, а `PurchasePrice` ключуется парой `(telegramUserId, sku)` без привязки к магазину,
так что одна загрузка обслуживает все магазины продавца. Отказ в приёме оставлял бы продавца с одним
лишь FBY вовсе без «Прибыли». `stock-upload.handler` поэтому **предупреждает и продолжает**: сперва
кэш `YandexMarket.stores` (после смены магазина в боте модель заведомо известна — пикер сам работает
из этого кэша, и типовой случай обходится без запроса), иначе один вызов
`StockSyncService.placementFor()`. Предупредить надо ДО скачивания: пообещать «загружаю остатки», а
через минуту прислать «остатки не записаны» — значит выглядеть сломанным.

Рубежей три, и обработчик — не запрещающий. `StockSyncService.sync` выясняет модель сам живым
`listStores()`, а **последний рубеж стоит внутри `writeInBatches`**, вплотную к единственному
`updateStocks` и до `getWarehouseId()`. Довод тот же, что у `featureGate` против `featureMenuLayout`:
проверка в одном обработчике не защищает следующий путь записи. Обработчик спрашивает сервис, а не
зовёт `listStores` сам, — правило и способ его выяснить должны жить в одном месте.

Второй вход в тот же `writeInBatches` — `StockSyncService.writeStocks` (TASK-143, «Передача
остатков», `src/modules/stock-push/README.md`): запись уже посчитанных остатков. У `sync()` есть
режим без записи `stocksByPlan` (CRM при открытой `stock_push`): разбор, закуп и свой склад как всегда,
модель не спрашивается, `writeInBatches` не вызывается; итог — `stocksByPlan: true`, а не
`writeSkipReason` и не `dryRun` (это не отказ и не просьба о проверке, остатки пишет план). Env и модель он
выясняет сам, не принимает от вызывающего; `writeInBatches` дополнительно отменяет запись целиком,
если хоть одно число отрицательное или нечисловое.

Ранний слой общий для бота и CRM: `stocks/stock-upload-policy.ts` (чистый `decideUpload`, лимиты
файла и `skipReasonOf` — тот же, которым пользуется `StockSyncService.sync`, правило одно) и
`StockUploadPolicyService` (env и модель: кэш → `placementFor`). Порядок: env → фича → модель. Тексты
причин — `stock-upload.texts.ts` и `stock-report.ts`, у CRM без разметки (`toCrmStockView`).

Неопределившаяся модель запрещает запись везде, но имеет **свой текст** (`PLACEMENT_UNKNOWN`):
приписать продавцу FBY, когда просто не отвечает Маркет, значит отправить его менять магазин,
которого менять не надо.

### Запись остатков включается явно: `STOCK_WRITE_ENABLED`

Разработка идёт против **боевого** магазина: токен в `.env` настоящий, и локальный запуск с
присланным прайсом менял бы остатки живого продавца — откатить это нечем.

Переменная **обязательна и без умолчания**: каждое развёртывание заявляет решение само, а забытая
переменная роняет старт с внятным текстом. Умолчание любого знака плохо — «можно» однажды перепишет
остатки с чьей-то локальной машины, «нельзя» тихо выключит загрузку в проде и всплывёт жалобой через
неделю.

Из `NODE_ENV` не выводится намеренно: «продовость» и «можно ли трогать чужой склад» — разные вопросы,
и связать их значило бы менять второе, правя первое. Правило Joi — `valid('true','false')`, а не
`Joi.boolean()`: при коэрции строка `'false'` истинна, и такая опечатка включила бы запись молча.

Проверяется **раньше модели**, поэтому при выключенной записи Маркет о размещении даже не
спрашивается.

### Почему повод — разряд, а не набор флагов

Поводов не отправить остатки четыре: просьба продавца (`dryRun`), модель магазина, запись, выключенная
средой (`STOCK_WRITE_ENABLED=false`), и выключенная администратором фича «остатки из прайса».
Итог у всех общий, а действие требуется разное — прислать файл без пометки, сменить магазин, ничего
(среда) либо написать администратору. Поэтому результат несёт `writeSkipReason: 'placement' |
'write-disabled' | 'feature-disabled'`, а не набор булевых полей: по флагам с общим итогом отчёт не
смог бы сказать, что именно произошло. `dryRun` остаётся отдельным полем намеренно — это просьба, а
не отказ. Внутри `'placement'` случаи «FBY» и «не определилась» различает `placementType`. Порядок
поводов: среда → фича → модель (при более раннем запрете модель у Маркета даже не спрашивается).

Запрет **понижает запись до сверки, а не отменяет загрузку**: файл разбирается, закуп ложится в нашу
Mongo, и «Прибыль» считается. Исключение — выключенная фича «закуп из прайса»
(`savePurchasePrices: false` в опциях `sync`): тогда закуп не пишется, а отчёт объясняет это через
`purchasePricesSkipped`. Обе фичи прайса продавец получает включёнными по умолчанию; выключаются
они по отдельности из веб-панели.

### Склад записи — только собственный

`getWarehouseId()` больше не берёт первый склад из ответа. `offers/stocks` перечисляет склады, где
лежит товар кампании, и среди них бывает чужой: на FBY это склад Маркета, на FBS — **склад возвратов
Маркета**, куда попал невыкупленный заказ (документация `getStocks` описывает это прямо). Правило по
модели такой случай не ловит: модель-то пишущая, чужой здесь конкретный склад.

При `limit: 1` выбор зависел от того, какой склад Яндекс поставит первым, то есть остатки всего
магазина могли уехать на склад возвратов. Теперь запрашивается `WAREHOUSE_PROBE_LIMIT` складов, и
результат пересекается с `GET v2/businesses/{id}/warehouses` — **вместе со складами из групп**: те
приходят в `warehouseGroups` и в общий список не дублируются, не учесть их значило бы объявить свой
склад чужим. Пустое пересечение — ошибка, а не «возьмём первый»: писать наугад хуже, чем не писать.

## 🏬 Обзор складов

`WarehousesService.overview(store)` — только чтение, ничего не пишет (как `OrderReportsService`).
Отдаёт `{ fulfillment, store }`, где различаются **два принципиально разных склада**:

- **FBY — склад Маркета** (`GET v2/warehouses`, `getFulfillmentWarehouses`): товар хранит и отгружает
  сам Яндекс. Список общий для токена, кампания/бизнес не нужны.
- **Склад магазина** (`GET v2/businesses/{businessId}/warehouses`, `getWarehouses`): собственные
  склады отгрузки продавца (FBS/DBS/Экспресс). Склады, входящие в группу, приходят отдельным списком
  `warehouseGroups` и в общий `warehouses` **не дублируются** — клиент собирает оба, помечая
  групповые именем группы; `express` берётся с самого склада.

Оба запроса идут одним `Promise.all` — разные методы разных разделов, между собой не зависят. Пустой
список любого типа — нормальный ответ (у продавца может не быть FBY вовсе). Версия путей — `v2`, как и
у остальных актуальных методов: вся модель Partner API переехала на v2 одновременно.

Под каждым складом Маркета печатаются **его остатки** — те же семь типов, что в сводке FBY, и теми
же словами (`STOCK_SHORT_LABEL`, `formatCount` импортируются из `fby/fby-message`: два экрана про
один склад обязаны звать одно и то же одинаково). Источник, соединение со списком и итог — в
«Warehouses» ниже.

Текст собирает `warehouses-message.ts` (чистый модуль). Печатается **id склада** — он не секрет и
виден в кабинете, — но **не** `campaign_id`/`business_id`.

> ⚠️ **Кнопка «🏬 Склады» временно убрана из раскладки** (`MENU_LAYOUT` в `menu.constants.ts`) — одной
> выключенной фичи мало, администратор фичевый фильтр обходит. Экран цел и достижим текстом: `bot.hears`,
> фича, гейт и хендлер на месте. Вернуть — добавить ряд `[MENU.WAREHOUSES]` обратно. Описанные ниже два
> условия при этом остаются в силе и снова заработают сами.

В боте это кнопка «🏬 Склады», и условий у неё **два**: фича `warehouses` (по умолчанию
**выключено**, включается точечно из веб-панели) **и** активный магазин на модели FBY —
`featureMenuLayout` вырезает кнопку при невыполнении любого из них, а хендлер перепроверяет модель
сам (подпись можно набрать текстом) и на не-FBY отвечает отказом с советом «🏪 Сменить магазин»
(`fbyOnlyScreenText` в `stocks/placement.ts`). Администратору фичевый фильтр не применяется (гейт
его и так пропускает, а записи флагов у него нет), условие по магазину — применяется.

## 📦 Сводка FBY

`FbyService.buildData(store)` — структура экрана (`IFbyOverviewReport`: данные, момент съёмки остатков, книга);
`build` бота — формат поверх неё, CRM (kind `fby:overview`) отдаёт её же. API-only, читает и ничего не пишет. Один экран из **четырёх независимых,
МЯГКО ДЕГРАДИРУЮЩИХ** источников (пятый — поставки, только при фиче `fby_supply`, см. «Второй заход» ниже) (каждый в своей try/catch → заглушка + `errors.report`, паттерн
`ProfitService.returnedOrderIds`; сбор одним `Promise.all`):

1. **Остатки по типам** (AVAILABLE/FIT/FREEZE/QUARANTINE/DEFECT/EXPIRED/UTILIZATION) — добывает
   `fby/fby-stock.service.ts`, **общий с экраном «🏬 Склады»** (single-flight, мемо и лимит генерации —
   «Warehouses» ниже). Сам цикл — из
   **асинхронного отчёта** `POST reports/stocks-on-warehouses/generate` → поллинг `GET reports/info/{id}`
   → скачивание → разбор. **Синхронный `offers/stocks` (getStocks) для FBY отдаёт пусто** — проверено
   на боевом; остатки по типам есть только в отчёте. Формат отчёта — **CSV** (плоская таблица SKU×склад):
   `FILE`-вариант отдаёт декорированный xlsx без строк данных и не годится. CSV приходит ZIP'ом (одна
   запись, deflate) — распаковка встроенным `zlib.inflateRawSync` через central directory, без внешней
   зависимости; затем `XLSX.read(csv)`. Всё в `fby/fby-stock-report.ts` (чистый, юнит-тест на инлайновом
   CSV; распаковка проверена живым прогоном). Кроме общих итогов парсер копит те же типы **по складам**
   (колонка `WAREHOUSE`, в одном цикле с `totals` — суммы сходятся по построению), а сообщение сворачивает
   их в **кластеры-территории** («Москва», «Самара», «Екатеринбург»…) по реестру `fby/fby-clusters.ts` —
   leaf-модуль по образцу `reports/brands.ts`: маркеры-подстроки в порядке объявления, API кластеров не
   отдаёт. Склад, незнакомый реестру, печатается **собственным именем** отдельной строкой, а не прячется
   в «прочие»: новая площадка Яндекса видна без правки кода.
   Под списком типов печатается **строка-расшифровка** (`STOCK_HINT` в `fby/fby-message.ts`) — что
   такое резерв, карантин и «к утилизации»: это термины склада Маркета, и без них цифра ничего не
   сообщает (продавец спросил, что означает карантин и не приёмка ли это возвратов). Строка в том же
   сообщении, а не отдельный экран-справка: ради трёх слов экран не заводят, а объяснение нужно ровно
   там, где стоят цифры. Слова в ней те же, что в `STOCK_LABEL`/`STOCK_SHORT_LABEL` — один экран не
   должен звать одно и то же по-разному. На экране «🏬 Склады» её нет намеренно: он отвечает на другой
   вопрос и уже упирается в лимит сообщения.
2. **Проблемные позиции** (DEFECT/EXPIRED/UTILIZATION > 0) — из ТОГО ЖЕ отчёта, группировка по SKU.
   До 30 позиций — списком в сообщении, больше — только счётчиком.
3. **Заявки на вывоз/утилизацию** — `POST campaigns/{id}/supply-requests` (v2; v1 → 404), фильтр
   `requestTypes=[WITHDRAW,UTILIZATION]`. Статусы шире enum openapi → маппятся в подписи с fallback
   на сырой код; сортировка «готово забрать» вперёд, терминальные (`CANCELLED`/`FINISHED`) в конец.
   `SUPPLY_STATUS` живёт в `report-status-map.ts` (как `SUBSIDY_TYPE`): литерал `CANCELLED` совпадает
   со статусом заказа, и «статусы не размазаны» ловит его в любом другом файле.
4. **«Едет до клиента» / «Едет обратно»** — переиспользование `OrderReportsService.build(...).count`
   для `REPORT.IN_TRANSIT`/`REPORT.RETURNING`.

**К сводке ВСЕГДА прикладывается xlsx** (`fby/fby-workbook.ts` — отдельный билдер, `report-workbook.ts`
завязан на заказы), три листа: «Остатки по складам» (склад × 7 типов + ИТОГО), «Позиции по складам»
(плоская таблица SKU×склад прямо из отчёта, парсер копит её тем же циклом, что итоги — сходятся по
построению; строки, где по всем типам ноль, отброшены) и «Проблемные FBY». Всегда, а не «когда не
влезло»: таблица позиций — тысячи строк, в 4096 символов сообщения она не помещается ни при каком
пороге, а файл-по-условию заставлял бы продавца гадать, почему в этот раз его нет. Само сообщение
режется `splitMessage` — проблемные позиции, заявки и кластеры вместе перерастают лимит, и на
превышение Telegram отвечает 400, то есть сводка не доходила бы вовсе.

Экран небыстрый (отчёт ~10–20 c; лимит генерации, мемо, дозапрос недождавшегося отчёта и разбор провала —
в «Warehouses» ниже). На rate-limit выводится отдельная заглушка «попробуйте через минуту», админам алерт
не уходит. Кнопка «📦 FBY» закрыта фичей `fby`
(по умолчанию **выключено**) и, как и «Склады», живёт только у FBY-магазина — оба условия и отказ
на не-FBY устроены одинаково.

## 🧾 Финансовые отчёты (M16)

Разведка — `scripts/diagnose-finance.ts`; карта отчётов и ключ дедупа — в `tasks.json`
(`reference.decisions.finance_ym_report_map`, `finance_ym_dedup_key`). Правила:

- Финансовые отчёты заказываются в `format=JSON`: `generateReport(path, body, 'JSON')`. Ответ — **ZIP**,
  по JSON на лист, в каждом `{rows: [...]}`. Разбирать только через `unzipReportJson` (`report-zip.ts`).
- Пути: `unitedNettingGeneratePath`, `unitedMarketplaceServicesGeneratePath`, `unitedOrdersGeneratePath`,
  `unitedReturnsGeneratePath`, `goodsRealizationGeneratePath`. Тела отчётов united: `businessId` и
  `dateFrom`/`dateTo` в ГГГГ-ММ-ДД (устаревшие `dateTimeFrom`/`dateTimeTo` не слать), реализация —
  `campaignId`, `year`, `month`. Квота — 100/час.
- Журнал операций — `united-netting`. Знак `transactionSum`: «+» — деньги продавцу, «−» — удержание.
  В services знак обратный: «+» — стоимость услуги. `Списание` в netting — оплата баллами, не деньги.
- У строк журнала нет id: ключ — устойчивые поля + номер среди одинаковых строк; поля выплаты
  (`paymentStatus`, `bankOrderId`, `bankOrderDate`, `bankSum`) в ключ не входят.

## ☠️ Что здесь мертво

- `api/**` — сгенерированный `npm run api` клиент. Исключён из tsconfig, не импортируется нигде, а его
  `core/request.ts` умеет только `Authorization: Bearer`, что для Yandex неверно. Не расширять.
- `handlers/price.changer.handler.ts`, `services/{offer,campaign}.service.ts` — прежний путь изменения
  цен. Живёт только в мёртвой цепочке Bull; в нём же хардкод предметной области («Наручные часы » +
  название) и надбавка «+5 ₽» на одном из двух путей обновления.
- Вне модуля — `src/services/yandex-market-api.service.ts` (429 строк, захардкоженный base URL и Bearer, не
  импортируется нигде). Тоже мёртвый клиент, не расширять.

## 📚 Документация Partner API

Локальная выгрузка спецификации — `api-docs/openapi/`. Она **отстаёт** от живой документации, но
полезна как справочник по полям: описания параметров запроса (`components/parameters/`) и схем ответа
(`components/schemas/`) читать в первую очередь оттуда — именно там нашлись и исключающий `toDate`, и
смысл `subsidies` как вознаграждения партнёру.

## Магазины для CRM (`stores/`)

`StoresService` — список магазинов токена (кэш `YandexMarket.stores`, пустой добирается одним
запросом), магазин по ключу из URL и смена токена с проверкой по Маркету. Веб активный магазин бота
не переключает: `scopeStore` перекрывает документ выбранной кампанией на один запрос, и отчёты CRM
считаются по ней. Кампании нет в кэше токена — перекрытия нет (это и проверка доступа). Подробности и
доводы — в `src/modules/crm/README.md`, «„Магазины“ в CRM».

## Доводы и история решений

> Перенесено из корневого `CLAUDE.md` (2026-10-18), чтобы он не грузил в каждую сессию то, что нужно
> только при работе в этом модуле. Дубли с верхней частью слиты: выше остались только правила, которых
> здесь нет (клиент, структура, запись остатков, склады, FBY, финотчёты, мёртвый код), и отсылки сюда.
> Всё про «Продажи», «Едет обратно», периоды, «Прибыль», калькулятор тарифов и экраны Partner API — здесь.

### Warehouses: the list is the screen, the stock is enrichment

Кнопка «🏬 Склады» сейчас убрана из `MENU_LAYOUT` — см. «🏬 Обзор складов» выше.

«🏬 Склады» prints each Market warehouse **with what lies on it**. The numbers come from the same
`stocks-on-warehouses` report as «📦 FBY» — the synchronous `getStocks` returns empty for FBY, so
there is no cheaper source — which is why the screen stopped being two instant GETs and moved to the
queue like «📦 FBY» did.

- **One report, one fetch loop, one place that knows about the limit.** generate→poll→download→parse
  moved out of `FbyService.safeStock` into `FbyStockService` (`fby/fby-stock.service.ts`), injected
  by both screens (and since then by `StockLevelsService` — остатки FBY для CRM). Not "make `safeStock` public and inject `FbyService`": that class is the _builder_
  of another screen — it returns text and an xlsx, knows the inline limits and drags
  `OrderReportsService` — so tomorrow any new dependency of the FBY summary would silently arrive in
  the warehouses screen.
- **The generation limit is handled by single-flight + a 120 s memo, not by refusing a screen.**
  The limit was 1/min (and the memo was 60 s — exactly that window); by 10-2026 the docs say **1 per 2 minutes** without a subscription (1/min
  with Medium), so the memo is sized for the worse case.
  A parallel call awaits the same promise; a repeat within the window gets the parsed report. Since
  the next generation cannot start until a TTL **after** the previous one finished, the interval is
  always over the window and the limit is unreachable by construction — without it the second screen
  loses the race by design. A failure is deliberately **not** memoised (a one-off outage would stick
  for a minute and pressing the button again would fix nothing), and the snapshot carries `takenAt`,
  the moment it was **taken** — which is why the screen prints two timestamps, header (when the screen was built) and stock line
  (when the stock was taken) — они расходятся, когда отчёт взят из свежего разбора. Без времени обзор
  нечем сверить с кабинетом (тот же приём, что у «Едет до клиента»).
  The queue latch (`queue/queued-for-user.ts`) therefore stays per-job-name: it guards double taps,
  not the limit.
- **A report we stopped waiting for is resumed, not re-ordered.** On 12–13-10-2026 the report sat
  in `PENDING` for 50 minutes and then came back `FAILED` with no `subStatus` (accepted 03:39Z,
  failed 04:29Z). A retry the same morning failed within a second. Each button press used to queue
  **one more** report behind the stuck one. Now a poll timeout (we wait up to 10 min) leaves the `reportId` in
  `FbyStockService.pending` for an hour, and the next call polls that report instead of generating a
  new one. A final answer, file or `FAILED`, clears it.
- **Why a report failed is visible in the admin panel.** `pollReport` throws `ReportGenerationError`
  (`yandex/report-generation.error.ts`), which carries `reportId` and what Market said: status,
  `subStatus`, `generationRequestedAt`/`FinishedAt`, `estimatedGenerationTime`, and how long we
  waited. `ErrorReporter` copies these into `ActionLog.details` (Mixed, unindexed), uses
  `GET /v2/reports/info/<id>` as `requestUrl`, and `MessageModal` prints them. Before this, the
  `reportId` existed only in a debug line of `docker logs`, and Market's timestamps existed nowhere.
  `details` is a general-purpose field, so any other error can fill it too.
- **The join is by name and exact.** There is no shared identifier — `GET v2/warehouses` gives a
  numeric `id`, the report only a `WAREHOUSE` column with a name. `warehouses/warehouse-stock.ts`
  (pure) normalises (case, `ё`→`е`, quotes, dash variants, whitespace) and compares for equality.
  Substring matching is refused on purpose: «Ростов-на-Дону-1» and «Ростов-на-Дону-2» are different
  sites and glued numbers would move **silently**, whereas an unmatched row is visible on the screen.
- **Nothing is hidden, and the sum stays reconcilable.** A warehouse in the list but not in the
  report is «пусто» (the report is a full SKU×warehouse table, so absent means empty, not unknown —
  hence `totals: null` means "no report at all" and nothing else); a warehouse in the report but not
  in the list prints under its CSV name with «нет в списке складов Маркета»; rows with no warehouse
  become «склад без названия» when non-zero. Same-named warehouses of the list collapse into **one**
  row carrying both ids — the report gives one set of numbers per name and there is nothing to split
  it by, while two rows would double-count. «Итого» is summed **from the printed rows**, so what is
  shown adds up to what is signed underneath; taking `summary.totals` instead would hide a join bug.
- **Cluster-territories are deliberately not reused here.** Folding is the answer of «📦 FBY»; this
  screen answers "which warehouses do I have and what is on each", and folding would destroy exactly
  that. Two screens repeating one answer in the same words is the drift «one screen, one text»
  exists to prevent.
- **`GET v2/warehouses` is the whole list available to the token**, not "my warehouses", so with a
  stock line under each entry 4096 characters stopped being theoretical — the processor sends through
  `splitMessage` (its first live use). Stock unavailable degrades to exactly the old screen plus one
  reason line (`fbyStockUnavailableLine`, shared with «📦 FBY» — one failure must not be described by
  two different sentences): обогащение не имеет права убрать экран, который работал без него.

### Yandex Market access

> Историческая запись: этот путь теперь мёртвый — см. «☠️ Что здесь мертво» выше. Живой клиент —
> `YandexApiClient` (`yandex-api.client.ts`, «🔑 Клиент» выше).

Former live client: `src/modules/yandex/handlers/price.changer.handler.ts` — `PriceChanger(token,
campaign_id, business_id)` over `src/transport/http/index.ts` (axios wrapper with logging
interceptors and 5xx/network retry), delegating to `modules/yandex/services/{offer,campaign}.service.ts`.
Auth is the `Api-Key` header with the **per-user** token; a fresh `PriceChanger` is constructed per
job. `loadAllOffers` pages via `page_token`. Batch limits (50 price/stock with 1s sleep, 100 create
with 2s sleep) live in `PriceChanger`.

Два мёртвых клиента — в «☠️ Что здесь мертво» выше.

### Продажи, а не платёж покупателя: одна формула на все отчёты

Every order report prints «💰 Продажи» — **the seller's money, not the buyer's**. The seller put it
plainly: there are three prices (purchase, their own sale price, and what the customer pays), and the
third one «мне вообще похер». Until TASK-057 the reports printed exactly that third one: `itemsTotal`
under the label «Товары». The Market discounts by subsidy and **reimburses the seller**, so the sale
price exceeds the buyer's payment — on the live store's «Едет до клиента» snapshot (09-08-2026) that
is 1 037 182 ₽ of payments against 182 876 ₽ of subsidies, **+17,6 %**.

- **The formula lives in exactly one place: `orderTotals` (money.ts).** It used to be written by hand
  in `profitOf` and in `tariff-estimate.ts` and nowhere else, which is precisely how four screens
  ended up showing a number the seller never asked for. Now `IMoneyTotals` is
  `{sales, subsidies, withDelivery}`, `profitOf` destructures it (как и калькулятор тарифов), and
  «Прибыль» and «Едет до клиента» cannot disagree by construction.
- **There is no «buyer's payment» field in `IMoneyTotals`, deliberately.** Two similar numbers side by
  side reproduce inside our own type the very trap money.ts is written against (`total` vs
  `itemsTotal`): the next report takes the wrong one, and that does not crash — it quietly diverges
  from the cabinet. The payment is recovered as `sales − subsidies`, pinned by a test.
- **Renaming `items` → `sales` was the point, not a side effect.** Adding a field would have broken
  nothing and the defect would have survived in every consumer somebody forgot; the rename made the
  compiler name all six of them (`DRAFT_FIELD_SET` argument).
- **The breakdown line «в т.ч. субсидии Маркета» is mandatory and shares `SUBSIDIES_LABEL` with the
  profit screen.** Without it the new number reconciles with nothing — the cabinet shows the buyer's
  payment, and the seller remembers the old «Товары». It is skipped at zero: «субсидии 0 ₽» says
  nothing. Порядок строк сообщения: «💰 Продажи», под ней «в т.ч. субсидии Маркета», затем «🚚 С доставкой»;
  в .xlsx три денежные колонки в том же порядке — «Сумма продаж», «в т.ч. субсидии Маркета», «Сумма с
  доставкой». The .xlsx keeps the column **even at zero** — a workbook has a fixed schema, and a column
  that disappears breaks the pivot tables built on the previous export.
- **A return record contributes `subsidies: 0`.** The returns endpoint gives one `amount` with no
  breakdown; the Market's share in it is unknowable and a guessed one would inflate the subsidy line
  plausibly and silently. Consequence to remember: in «Едет обратно» the breakdown covers only the
  non-redemptions taken from the orders endpoint, and a non-redeemed order still carries its subsidy
  into «Продажи» although that money will never arrive — an accepted cost of "all order reports"
  being one function.

### «Едет обратно»: два источника и три грабли на возвратах

The report sums non-redemptions from the **orders** endpoint (by return substatuses) and records from
the **returns** endpoint, deduped by `orderId`. The returns half was broken three separate ways, and
each failure was silent.

- **The response shape differs between methods.** `GET .../orders` returns `{ orders, paging }` at
  the top level; `GET .../returns` returns `{ status, result: { returns, paging } }`. The client read
  `data.returns`, which was always `undefined`, so the method quietly yielded an empty list and the
  report showed only the orders half — actual returns, never. No error was ever raised: "no returns"
  is a legitimate answer, and from the outside it is indistinguishable from "we looked in the wrong
  place". `getReturns` now reads **both** levels, and a test pins the live shape.
- **Only one stage out of five was queried.** `shipmentStatuses` was `['IN_TRANSIT']`, which showed
  38 returns where the cabinet showed 50. `RETURN_STAGE` splits the five stages into `inFlight`
  (`CREATED`, `RECEIVED`, `IN_TRANSIT`, `READY_FOR_PICKUP` — **this sum is the cabinet's number**)
  and `settled` (`PICKED`); `declared` is left for an unknown status only. Стадии перечислены в
  `RETURN_SHIPMENT_STATUS`, раскладка по группам:

  | Стадия     | Статусы                                                 | Смысл                                              |
  | ---------- | ------------------------------------------------------- | -------------------------------------------------- |
  | `inFlight` | `CREATED`, `RECEIVED`, `IN_TRANSIT`, `READY_FOR_PICKUP` | едет к продавцу — **это число и видно в кабинете** |
  | `settled`  | `PICKED`                                                | выдан магазину, путь закончен                      |
  | `declared` | неизвестный статус                                      | не едет и не доехал                                |
  | `dead`     | `CREATED` с отменённым возвратом денег                  | заявка не состоялась — не считается вовсе          |

- **What kills a return is its `refundStatus`, not its stage — and getting that backwards cost a
  second complaint.** `CREATED` used to be `declared`, i.e. out of "in flight", from a correct
  reconciliation with the wrong conclusion: `RECEIVED + IN_TRANSIT` was exactly the cabinet's 50 and
  adding `CREATED` gave 52. The two extra were not "declared but not handed over" — they were
  **dead**: a buyer's request that was cancelled or rejected and then lies in the response for
  years (one on the live account was created 19-03-2026, `refundStatus: CANCELLED`, and has not
  moved since). Live check 09-08-2026, FBS `148655119`: the three transit stages give 66 records /
  **65 orders** against the cabinet's **68**, and adding the live `CREATED` entries (three, all
  filed within two days) gives exactly 68. So `returnStage(shipmentStatus, refundStatus)` returns a
  fourth stage `'dead'` for a `CREATED` whose `refundStatus` is in `RETURN_DEAD_REFUND_STATUSES`
  (`CANCELLED`, `REJECTED`), and `collectReturns` skips those entirely — **before** the dedup, or a
  dead request would claim the `orderId` and evict the live return of the same order.
  - The refund check is deliberately **narrow: `CREATED` only.** That stage is one request by the
    buyer, and a cancelled request never became a return. On every other stage the parcel is
    physically moving to the seller and a money decision does not stop it — a cancelled refund in
    `IN_TRANSIT` still lands on the seller's warehouse.
  - **The `orderId` dedup is correct and must stay**: the cabinet counts orders too. On the live
    account one order carries **two** IN_TRANSIT returns, and 68 only reconciles when counting
    distinct orders (69 records → 68 orders).
  - `RETURN_ACTIVE_STATUSES` is not written by hand — it is `RETURN_STAGE` filtered by `inFlight`,
    so a new status gets its decision in one place and reaches (or doesn't reach) the query for free.
  - `npx ts-node scripts/diagnose-returns.ts --user=<id> [--list]` is the read-only сверка that
    settled this: a full unfiltered walk of `/returns`, the breakdown by `shipmentStatus` and by
    `refundStatus`, and the candidate numbers (old rule / current rule / current rule without the
    dead filter) side by side, in records **and** orders. This class of bug raises no error and
    fails no test — the report just shows a different number, and the seller is the one who notices.
  - `IReturnRecord.returnId` reads `id` first: the field is called `id` in `ReturnDTO`, so while the
    mapper read only `returnId` it was `undefined` on every record.
- **The period was not applied at all.** The returns method takes no dates — only `pageToken`,
  `limit`, `shipmentStatuses` — so half the report was cut by `updatedAt` and half was not, and «за
  сегодня» and «с 1 числа месяца» returned the same set. That is precisely what the seller reported
  as "returns for the current month are not visible": the number had nothing to do with the month.
  Filtering now happens on our side by `creationDate` via `withinPeriod`, in Moscow calendar days
  rather than millisecond arithmetic. A return with no date counts as **outside** the period —
  silently folding a broken date into the current month is worse than dropping it, because the number
  stops matching the cabinet with nothing to explain why.
- **`PERIOD.ALL` («Всего») is not another range, it is the absence of one — and for returns it means
  ACTIVE ones, not all of them.** "Every return ever" is 1979 records of which 1928 are already
  handed to the shop (в другой замер — 2137 записей, из них 2011 выданы): a number that answers nothing. Without a period the only useful question is
  "what is coming back to me right now", and that is the number checked against the cabinet. So
  `collectReturns` asks for `RETURN_ACTIVE_STATUSES` (the `inFlight` three) when unbounded and all
  five when a period is chosen — the period view wants the full picture of the month, closed returns
  included. Side benefit, and a large one: one page instead of twenty (5.5 s vs 27.7 s measured live).
  For **orders**, `ALL` still means whatever Partner API keeps (~30 days), so the report prints that
  caveat — «Всего» without it reads as a promise it does not keep. `ALL` stays out of
  `SCHEDULE_PERIODS`: a daily digest "for all time" would send the same number every day.
- **The report goes out as an `.xlsx` attachment** (`exportReturning` → `buildReturningWorkbook`,
  same `IReportExport` contract as «Едет до клиента»), report text as the caption, empty result as
  text with no file. **One row per item, not per order** — артикулы are the point of the export, and
  squashed into one cell they neither filter nor pivot. The two halves are asymmetric: order items
  carry `offerId`/`offerName`/`count`; the returns endpoint's `items[]` has only `shopSku` + `count`
  and **no product name** — the mapper renames `shopSku` → `offerId` (one shape downstream, pinned by
  test) and the «Товар» column stays empty rather than joined from Mongo, because
  `OrderReportsService` stays API-only. `IReturnsSummary.records` is filled at the same line as
  `count += 1`, so the file matches the message's numbers **by construction**, not by parallel
  filters. No money columns: a return item has no price of its own, and an order-level sum repeated
  per item row double-counts in the pivot tables sellers build — money is already in the caption.
  Both send paths branch on `REPORT.RETURNING` (handler and `reports.processor.ts`); the digest reads
  the saved period **before** the export branch now, since this export, unlike IN_TRANSIT, is
  period-aware.
- **«Уехало клиенту» тоже уходит файлом** (`exportShipped` → `buildOrdersWorkbook`,
  `uehalo-klientu-…xlsx`) — обе ветки, кнопка и рассылка (`exportFor` в `reports.processor.ts`).
  Его определение — `DELIVERY+PICKUP+DELIVERED` по дате отгрузки: `DELIVERED` намеренно (заказ,
  отгруженный во вторник и уже выкупленный, всё равно уехал в тот вторник), иначе
  отчёт за прошлый день худел по мере доставки; один `DELIVERY` давал 257 при кабинетных 381
  (сверка 09-08-2026, FBS 148655119: DELIVERY 257 + PICKUP 122). «Всего» — ДРУГОЙ вопрос: снимок
  «сейчас в пути», сверяемый с кабинетным «в доставке», без `DELIVERED` (`unboundedStatuses` в определении, подставляется через
  `effectiveDefinition` — одна точка и для запроса, и для отбора ответа), под флагом `deep_history`
  он идёт через архив `stats/orders` **без дат** (у getOrders неявный `fromDate` = 30 дней назад),
  и оговорка «не старше 30 дней» заменяется на «по архиву Маркета» (`viaArchive` в результате).
- **На FBY «Едет до клиента» включает `PROCESSING`, и это не отмена сверки 31-07-2026, а её
  сужение до FBS.** Там кабинет показывал 192 = DELIVERY 138 + PICKUP 54, а 38 заказов в
  `PROCESSING` (все с подстатусом `STARTED`) действительно лежали у продавца. На FBY товар лежит на
  складе **Маркета**, заказ собирает Маркет, собственной необработанной очереди у продавца нет
  вовсе — сборка там и есть начало доставки. Выражено полем `fbyExtraStatuses` в определении:
  **добавка, а не подмена** — `unboundedStatuses` отвечает на ДРУГОЙ вопрос и заменяет набор
  целиком, а эти два поля композируются в `effectiveDefinition(definition, context)` без правил
  приоритета (контекст — объект, иначе через полгода это вызов вида `(def, true, false, true)`).
  - **Модель размещения выясняет сам `OrderReportsService`, а не вызывающий** — в отличие от
    `deepHistory`/`tariffEstimate`. Тот паттерн существует потому, что фича живёт в `UserAccess`,
    куда сервису ходить нельзя; модель же — свойство магазина, который УЖЕ передан первым
    аргументом, и клиент к нему уже построен. А вызывающих у этого отчёта **три**: кнопка, рассылка
    и сводка «📦 FBY» (`FbyService.safeCount`) — экран, открытый только FBY-магазинам. Флаг,
    который каждый обязан не забыть, они забыли бы по-разному, и «в боте одно, в сводке другое» —
    известный тут паттерн жалоб. Запрос идёт **только** у определений с добавкой (кэш
    `YandexMarket.stores` → живой `listStores`), то есть на остальных пяти отчётах его нет.
  - **Модель не определилась = не FBY.** Расширить отчёт по догадке нельзя, сузить — это прежнее,
    сверенное с кабинетом поведение; та же политика, что у записи остатков, только там она
    защищает чужой склад, а здесь число в отчёте.
  - **Изменившееся число объясняется в самом отчёте** — строка «🏭 Из них собирается на складе
    Маркета» из `IReportResult.assembling`, посчитанного по ТЕМ ЖЕ заказам, что дали `count` (довод
    `IReturnsSummary.records`). Срез, который нечем разложить, невозможно ни проверить, ни
    оспорить — тот же довод, по которому в заголовке печатается момент съёмки.
  - **У «Уехало клиенту» добавки нет намеренно**, хотя его «Всего» — тот же срез «в пути»: это
    события **отгрузки** по `supplierShipmentDate`, а собираемый заказ не отгружен ни на какой
    модели. Решение пиннится тестом, чтобы не выглядеть забытой строкой.
  - Оговорка на будущее: добавка работает по статусу целиком — подстатус ею не сузить
    (`substatuses` типизирован подстатусами возврата). Если сверка на боевом FBY покажет, что часть
    `PROCESSING` кабинет «в доставке» не считает, нужно отдельное поле, а не правка этого.

### Profit

The fifth report (`REPORT.PROFIT`) is the only screen that shows money **after** costs. It prints
**two order sets**, and they are _not_ whole-and-part — the wording in `profit-message.ts` exists to
say so:

- **Оформлено за период** (`PLACED_DEFINITION`, `dateFilter: 'creationDate'`) — the figure the seller
  sees in their Yandex cabinet. Gets the full breakdown, and its bottom line is «Ожидается чистая»:
  these orders are still in transit and some will not be redeemed.
- **Выкуплено** — the `REDEEMED` set (`status=DELIVERED`, `dateFilter: 'updatedAt'`), money already
  received. One compact line beside the main block.

The two barely overlap: today's orders are redeemed a week later, today's redemptions were placed
earlier. Showing only the redeemed set is what made the report look broken — on 30-07-2026 it printed
9 orders while the seller counted ~40 placed (the API said 11 placed / 10 redeemed that day against a
40–50/day norm, both confirmed by two independent date filters). **When there are no placed orders,
the redeemed set gets the full breakdown instead** — otherwise a report for a quiet period collapses
into one line and loses commission, tax and cost.

- `PLACED_DEFINITION` deliberately has **no key in `REPORT`**: `Object.values(REPORT)` feeds
  `OrderReportsService.keys`, so a key would mint a report button and a digest row nobody asked for.
  `OrderReportsService.collectPlacedOrders` returns `{orders, cancelled}` — `CANCELLED` is requested
  in the same call and split locally, then printed as «Отменено: N». The cabinet lists cancelled
  orders too; staying silent about them would put our count below the seller's, which is the whole
  problem this report was fixing.
- **Partner API forbids some statuses in the `status` filter**: `PLACING`, `RESERVED`, `PENDING`,
  `PARTIALLY_RETURNED`, `UNKNOWN` answer `400 Statuses [X] are not allowed` and kill the **whole**
  report. `QUERYABLE_STATUSES` + `queryStatuses(definition)` filter the request; `matchesDefinition`
  still matches the response against the definition's full list, so meaning is not bent to fit the
  transport. This was a live bug, not a theoretical one: `REPORT.RETURNING` lists
  `PARTIALLY_RETURNED`, so «Едет обратно» answered «Яндекс.Маркет отклонил запрос» from TASK-054
  onward — before it, `status[]=` was ignored by Yandex, so the forbidden value never arrived.
  Cost of the fix: partially-returned orders are not fetched; a partial return in transit is still
  visible through the returns endpoint.
- **`toDate` is exclusive** — «заказы, созданные ДО 00:00 указанного дня» — so
  `creationDateParams` always shifts the upper bound one day forward. For a single day Yandex
  stretches the range itself and the bug is invisible; for «с 1 числа по сегодня» it would silently
  drop _today's_ orders, the ones the seller opened the report for.
- **One request may span at most 30 days, so a period is cut into windows** (`periodWindows` in
  `report-period.ts`) and `collectOrders` walks them in sequence. This is not defensive coding: on
  the **31st** «с 1 числа месяца» does not fit — `updatedAt` gives 30 days minus a second and the
  creation filter, with its shift, exactly 31 — and every period report answered
  `400 interval between … is more than 30 days`, i.e. the whole report died, on that day only.
  Cutting rather than clamping keeps the month a month; the extra request happens in 31-day months
  and nowhere else.
  - **Merging deduplicates by `order.id`.** Yandex interprets window edges itself (a range shorter
    than a day is stretched to a day), so an order at the boundary would otherwise be counted twice —
    both as a unit and as money.
  - `MAX_WINDOW_DAYS` is 30 and cannot be raised: the exclusive-`toDate` shift turns a 30-calendar-day
    window into a 30-day interval exactly, the largest the API still accepts («more than 30» is
    strict).
  - `assertPeriodSupported` checks the **age** of the period's start, never its length — the length is
    the windows' job. It is also why `splitIntoWindows` in `yandex-date-window.ts` stays unused:
    that one does millisecond arithmetic over `Date`, the very thing `moscow-day.ts` avoids.
- **«Едет до клиента» prints the moment it was taken** (`на 31-07-2026 09:12 МСК`), and the same
  moment goes into the file name (`edet-do-klienta-31-07-2026-0912.xlsx`). It is a snapshot, not a
  period, and a snapshot with no timestamp cannot be checked against the cabinet at all. The file
  name carries the time for a second reason: Telegram deduplicates uploads by content and hands back
  the **previously uploaded document together with its old name**, so a fresh export could appear
  dated yesterday. When date and caption disagree, the caption is the one computed at build time.

- **Arithmetic lives in `reports/profit.ts`**, a pure module beside `money.ts`. Both percentages are
  taken **from the sale sum**: `net = revenue − revenue×commission% − revenue×tax% − purchase`, i.e.
  `revenue × 0.70 − purchase` at the defaults. The tax base is the customer's decision, written down
  there — taking 7% off the post-commission remainder yields 539 ₽ instead of 700 ₽ on 10 000 ₽, and
  both look equally plausible.
- **Revenue is `itemsTotal` + Market subsidies**, goods only — and since TASK-057 that formula is
  **not this report's**: it lives in `orderTotals` (money.ts) and every order report prints it. See
  "Продажи, а не платёж покупателя" above; what follows is why the second term exists at all.
  `itemsTotal` is documented as «Платёж
  покупателя» and `item.price` as «цена без учёта вознаграждения партнёру за скидки по промокодам,
  купонам и акциям (параметр `subsidies`)» — the Market's discount is paid _by the Market_ and
  **reimbursed to the seller**, so the seller's revenue exceeds what the buyer paid. Verified on the
  live store for July (394 redeemed orders, cost 1 649 259 ₽): `itemsTotal` alone gave revenue
  2 456 985 ₽ and 4 % margin, adding subsidies gave 2 877 765 ₽ and 22 % — the latter is what the
  customer described (markup ~70 %, margin ~20 %), the former read as «the store works for free».
  Commission and tax are taken from the full sum including the subsidy, matching the customer's own
  worked example (`2689 × 23 %`, `2689 × 7 %`).
  - `subsidiesTotal` (money.ts) sums the **order-level** `subsidies`, never the per-item ones: an
    item's `amount` is **per unit** (live order #58841189889 — item with `count: 2` carried 276/565,
    the order 552/1130), so summing items without `× count` understates and with it double-counts.
    `DELIVERY` is excluded — that's delivery remuneration, the same reason `itemsTotal` excludes
    `deliveryTotal`. `SUBSIDY_TYPE` lives in `report-status-map.ts` because the literal `'DELIVERY'`
    is also an order status and the "statuses are not scattered" test rightly catches it elsewhere.
  - The report prints «в т.ч. субсидии Маркета» under Продажи, from the shared `SUBSIDIES_LABEL` —
    the order reports print the same line under the same label, and two wordings for one number
    would read as two different metrics. The line itself is duplicated deliberately: profit has its
    own block structure, and branching one formatter would put two unrelated reports in one function.
  - Earlier revisions of the docs claimed the opposite (that `itemsTotal` includes subsidy
    compensation while `Σ(item.price × count)` does not). On live data those two sums matched **to the
    rouble** (2 456 985) and neither contains subsidies.
- **A returned order is excluded whole, and returns come from a second endpoint.** A return _after_
  redemption does **not** move the order out of `DELIVERED` — it lives as its own entity in
  `GET v2/campaigns/{id}/returns`, so `ProfitService.returnedOrderIds` queries that method and
  `profitOf` drops those orders: goods came back, so there is no revenue, no commission, no tax and no
  cost. The check runs **before** the unknown-cost branch, or a returned order with no price-list row
  would be reported as «нет закупочной цены» and the seller would go re-upload the price list for
  nothing. The returns call is deliberately **unfiltered** — `shipmentStatuses` describes where the
  parcel is, not whether the money came back, and a July order returned in August must still leave
  July's profit; intersecting with the period is `profitOf`'s job. A failure of that endpoint goes to
  `ErrorReporter` (`context: 'profit:returns'`) and the report still renders, uncorrected. Cancellations and non-redemptions need no
  handling: they are not `DELIVERED`.
- **An order whose cost is unknown for any item is excluded whole**, and the report says how many and
  for how much. Treating a missing cost as 0 would inflate profit invisibly — that is why
  `orderPurchase` returns `null`, not `0`, and why `normalizeRate` rejects `null` separately
  (`Number(null) === 0`, so "no rate" would have become "zero commission"). Исключённое — одно поле
  `totals.unconfirmed` (TASK-119, тип из `src/shared/profit-confirmation.ts`, общий с P&L журнала;
  `src/modules/finance/README.md`, «Неподтверждённая прибыль»): заказы, сумма в копейках, артикулы,
  `confirmed` выводится из них. Экраны бота и CRM печатают его, своей формулировки не собирают.
- **A row missing from the catalog still yields a purchase price.** `StockSyncService` skips the
  _stock_ write when `resolveSku` finds nothing (an unknown sku 400s the whole batch) but stores the
  price anyway, keyed by the first candidate `stripBrand(name)` — the bare code is exactly what an
  order item's `offerId` carries. Dropping the row wholesale is how prices went missing: for July, 6
  of 7 skus with no cost were present in the uploaded price list with a price (`Daniel Klein 14081-4`,
  2280 ₽, row 16952) but had been removed from the catalog, while their orders remained. The report
  then asked the seller to «пришлите прайс с этими позициями» — which they already had. Stock and
  cost are independent: a zero or absent quantity does not affect the price at all.
- **Cost comes from the price list the seller already uploads for stock.** `IPriceRow.price` (column E)
  was parsed and discarded before; `StockSyncService` now also upserts it into `PurchasePrice`,
  **including in «проверка» (dry-run) mode** — that writes to our Mongo, not to Partner API, so profit
  works before the first live stock write. A repeat upload updates and **never deletes** rows absent
  from the file (a price list may cover one brand only); the report prints the last upload date so
  stale cost is visible.
- **Column E is the supplier's price, not the cost.** Cost = that price minus a negotiated
  **per-brand** discount. Verified on live data — without the discount the month showed a
  **117 622 ₽ loss**, with it a 34 340 ₽ profit. The brand registry lives in
  `reports/brands.ts` — a **leaf module with zero imports** (the `telegram-html.ts` pattern; both
  profit arithmetic and bot screens import it, so importing `profit.ts` from it would be a cycle).
  Each brand is `{title, markers, exclude?, inputLabels}`; `brandOf(row)` matches
  `${category} ${name}` against `BRAND_KEYS` **in declared order** (`vostok` first — its markers are
  the widest), with per-brand `exclude` checked before `markers` («Восток Кремлёвские» must land on
  the default discount — customer's decision). A row matching no brand → `null` → default discount.
  A drift-guard test pins that every `BRAND_PREFIXES` entry from `sku-resolver.ts` resolves to a
  brand — the two registries stay separate (different jobs: sku resolution vs discount) but may not
  silently diverge.
- **Per-seller discounts live in `YandexMarket.brandDiscounts`** — a plain-object map keyed by
  `TBrandKey` (the `UserAccess.features` pattern: only explicit decisions stored, missing key =
  default `discountPercent`, 10 %; легаси `vostokDiscountPercent` — 4 %). Written **only** via
  `updateProfitSettings` (to which `updateBrandDiscount` reduces) — a `$set` dot-path with an
  `isBrandKey` whitelist (the key decides _where_ in the document to write, same argument as
  `setFeature`); mutating the nested object + `save()` loses the change without `markModified`.
  **`vostokDiscountPercent` stays in the schema as the legacy fallback**: `discountsOf(store)` in
  `profit.ts` is the single place resolving the chain `brandDiscounts[brand]` → (vostok only)
  `vostokDiscountPercent` → `discountPercent`, so sellers who configured «Восток» before the map
  existed keep their value with **no data migration** — and the untouched default still prints
  «минус 10% (Восток 4%)» in the profit report, which only lists brands whose effective percent
  differs from the default. `0` in the map is a valid discount, not "no entry"; junk entries are
  dropped per-entry, never fail the report.
- **The discount is applied when computing, not when storing.** `PurchasePrice.price` holds the price
  exactly as printed in the file; costs are derived at report time — «Прибыль» и «Калькулятор» через
  `datedCosts` (история себестоимости на дату заказа + `costOn`, та же `discountedPurchase`), текущий
  закуп в CRM — через `applyDiscounts` (the config is built **once** per map, not per row). That is why `findBySkus` returns `{price, name, category}`
  rather than a number — the brand is derived from the stored name/category — and why changing a
  percentage takes effect immediately instead of waiting for the next upload.
- **Rates are edited by button, and still by message.** Both paths live in
  `api-settings.handler.ts` and write through `StoreSettingsService` (`setRate`/`setBrandDiscount`,
  shared with CRM) → `YandexMarketService.updateRate`/`updateBrandDiscount`, both reducing to
  `updateProfitSettings`. `TRateField` is now **three** fields (commission, tax, default
  discount) — «Восток» left the union and became an ordinary brand.
  - **By button:** the settings screen carries one inline button per rate plus one
    «🏷 Скидки по брендам» button (`BRAND_CB_MENU`, inline-only, deliberately **no `MENU` key**),
    built by `settingsKeyboardRows(store)` in `settings.text.ts` — the _same_ module as the screen
    text, and for the same reason: the screen has three entry points (`MENU.SETTINGS`, `/settings`,
    `check_settings`), and three copies of the keyboard would drift exactly as three copies of the
    text did. The value is printed **on** the button (`📉 Комиссия 23%`) rather than in a separate
    list, and `rateShortLabel` is deliberately short — Telegram truncates long captions in a
    two-button row. `RATE_CB_PATTERN`/`rateCallback`/`parseRateCallback` sit in `profit.ts` next to
    the rates themselves; the actions are registered in `registerCallbacks()`, so they are already
    ahead of the general `callback_query` switch and **no composer change was needed**.
  - **The brand screen** («🏷 Скидки по брендам», `bdisc:` codec in `brands.ts`) lists only brands
    **present in the seller's `PurchasePrice` rows** (`listNamesAndCategories` — a two-field `lean`
    projection, deliberately _not_ `distinct('category')` because brands also match by name), folded
    by `brandUsageOf` (`brands.ts`, shared with CRM) and rendered by `brand-discounts.text.ts` — the
    screen's single-source module (rendered
    from the settings button, after every save and after cancel). Rows outside every brand show as
    «Остальные» whose button reuses `rate:discountPercent` — one editor for the default, not two.
    Brand keys are ASCII slugs (`^[a-z0-9-]+$`, test-pinned): they travel in callback_data (64-byte
    limit), in `pendingRate` and in the Mongo `$set` path. A **legacy action**
    `rate:vostokDiscountPercent` maps the old «⌚ Восток» button (alive forever in chat history) to
    the vostok brand question.
  - **The pending question reuses `UserAccess.pendingRate`** with the value `brand:<key>` — this is
    _not_ the «23»-ambiguity the schedule fields guard against: both questions expect a bare percent
    with the same validation, only the write target differs, and the target is encoded in the value.
    `parseBrandPending` also accepts the legacy literal `vostokDiscountPercent` (→ `vostok`) so a
    question left open across the deploy resolves instead of dangling; `setPendingRate`'s whitelist
    is `isRateField(field) || parseBrandPending(field) !== null || parsePromoPending(field) !== null`
    (the same field also carries the promotion questions, `promo:`). `handlePendingRate` still runs
    **first** of the four pending checks and still consumes **numeric input only**
    (`parseRateValue`); a date or `09:00` is not a number and reaches its own handler. Non-numeric
    text closes the question and falls through, or an open rate question would make the bot answer
    «нужно число» to everything.
  - **By message:** `комиссия: 23`, `налог: 7`, `скидка: 10` parsed by `parseRateInput`;
    `скидка восток: 4`, `скидка casio: 5` parsed by `parseBrandDiscountInput` (labels derived from
    the registry's `inputLabels`), which `editSetting` calls **before** `parseRateInput` — «частное
    раньше общего», now between two parsers instead of between two keys of one map. Do **not**
    extend `parseLabelledValue`/`TDraftField` for this: that union drives `DRAFT_FIELD_SET`,
    `ONBOARDING_STEPS` and every `switch (step)` in `onboarding.ts`, whose numeric validation demands
    5–15 digits and would reject «23».
  - **Every label and example on screen is derived, never a literal.** `rateInputLabel` /
    `brandInputLabel` are read back out of the same tables the parsers use, so a hint is always a
    label the parser accepts, and the hints print the seller's **current** value: the screen used to
    show «Комиссия 25 %» and offer `комиссия: 23` two lines below. `RATE_FIELD_SET` and `BRAND_SET`
    are `Record<Union, …>` for the `DRAFT_FIELD_SET` reason — an array literal does not force the
    union to be complete.
- `ProfitService` (`reports/profit.service.ts`) joins the sources; `OrderReportsService` stays
  API-only. It fetches both order sets with one `Promise.all`, then makes **one** `findBySkus` call
  (plus one `CostHistoryService.findForSkus`) over their union and **one** returns call shared by both
  `profitOf` runs — the returns endpoint is the report's most expensive request. Both the button
  (`ReportsHandler.run` → `profit-report.processor.ts`) and the daily digest
  (`reports.processor.ts`) must branch on `REPORT.PROFIT` — a divergence between them is the known
  complaint pattern.
- **«🧮 По калькулятору Маркета» is a comparison line, not arithmetic** (`POST v2/tariffs/calculate`
  - offer dims/category from `getOfferMappings` (`marketCategoryId` + `weightDimensions` по артикулам;
    калькулятор считает по категории, цене, габаритам и весу); pure math in `reports/tariff-estimate.ts`,
    I/O in `ProfitService.tariffEstimateOf`). The flat `commissionPercent` stays the seller-controlled source
    of truth — the calculator is «примерный» by its own docs, so its sum prints under the commission
    line for сверка and never enters `profitOf`. Verified live (July-2026): calculator total is 23.9%
    of revenue when priced as `item.price + per-unit subsidies` (без `DELIVERY`) vs 20.0% without — the subsidy variant
    is the one baked into `tariffPriceOf`, because real commission is charged on the subsidized price
    (the seller's own worked example, 2689 × 23%).
  * **Behind `FEATURE.TARIFF_CALC`, `defaultEnabled: false`** — the registry's designed-for case:
    experimental, opened per seller from the panel, costs 2–8 extra Partner API requests per report.
    For the comparison **line** the flag maps to no update — both callers read it themselves and
    pass `{tariffEstimate}` into `ProfitService.build`; the service deliberately does not read
    `UserAccess` (Mongo доступа is the telegram layer's business). In `ReportsHandler` an absent
    access record means admin → flag open, the `allFeaturesEnabled` argument.
  * **«🧮 Калькулятор» is also a menu button — the sixth report, and a full P&L of its own.**
    `REPORT.TARIFF_CALC` = `'tariff_calc'` (report key == feature key, like the other five), which
    buys the whole report machinery for free: the period picker and `rep:` callbacks, «Другой день»
    via `pendingReportDay`, `featureGate` through `REPORT_TO_FEATURE`, the schedule section and the
    daily digest. Экран — `ProfitService.buildTariffReport` + `tariff-calc-message.ts` (один текст на
    кнопку и рассылку). Its definition takes the **placed** statuses (`PLACED_STATUSES`, `creationDate`,
    no `CANCELLED` — a cancelled order has no services); `PLACED_STATUSES` moved above
    `REPORT_DEFINITIONS` because the definition references it and `const` has no hoisting.
    - **The screen prints the same chain as «Прибыль»** — продажи → услуги → налог → продвижение →
      закуп → чистая — with the flat commission replaced by the calculator's services. The seller
      asked for it in those words («если бы ещё подтягивал закуп, и раздел чистой в него
      перенести»). Purchase cost comes from where it always does: `PurchasePrice` + история
      себестоимости (`datedCosts`)
      — Partner API has no cost of goods (`offer.purchasePrice` is in the spec and empty on both
      live stores).
    - **Two screens print a net now, and that is deliberate: a different BASE, not a different
      formula.** The arithmetic stays in `profitOf`, which gained an optional
      `services: Map<orderId, number>` — pass it and the commission is that sum instead of
      `revenue × commission%`. A second copy of the net calculation is exactly the pair that drifts
      (the help screens did). Hence the comparison line is mandatory: live, the calculator says
      ≈24–29 % against a configured 16 %, and without it the seller reads one screen as broken.
    - **An order counts only when BOTH its cost and its services are known** — `profitOf` excludes on
      either, and the excluded block names both reasons (нет закупочной цены / нет категории в
      каталоге). Returns drop the order whole, as in «Прибыль».
    - `byService` is accumulated in the **same pass** that builds the services map (`orderServices`
      in `tariff-estimate.ts`, shared with `estimateOf`), so the breakdown sums to «Услуги Маркета»
      by construction rather than by two filters happening to agree — the `IReturnsSummary.records`
      argument.
    - The button **enqueues** `SEND_TARIFF_REPORT` on the `reports` queue
      (`tariff-report.processor.ts`) for the same reason as «Прибыль»: windowed order queries plus
      catalog plus the calculator are tens of seconds, and waiting in the handler froze telegraf's
      polling loop for everyone. Its payload carries **no** feature flag, unlike `IProfitReportJob`:
      there the flag decides whether to print a line inside someone else's report, here it decides
      whether the screen exists at all — already checked by the gate and the handler. Отказ Partner
      API ДОХОДИТ до продавца текстом — этот экран и есть калькулятор, молчать ему нельзя (в отличие
      от строки в «Прибыли», которая при отказе молча не печатается). The button
      sits in the top row next to «💰 Прибыль» (money screens together; default-off keeps the row
      single-button for most sellers, and `withSwitchStore` may make it three for an admin — pinned
      in `price-changer-keyboard.test`).
  * **One estimate per report, for the main block only** — the same `placed.orders ? placed :
redeemed` predicate as `placedIsMain`, computed after `profitOf`. `formatProfitReport` re-checks
    `estimate.scope` against the block it prints into: if the two predicates ever drift, a line with
    the wrong set's numbers is worse than no line.
  * **An order not fully priced is excluded whole** (the `orderPurchase` argument), and the ≈% uses
    `coveredRevenue` as denominator — partial coverage says «по 3 из 5 заказов» instead of silently
    understating the percent. Missing dims fall back to 11×11×11 см / 0.3 кг (watch store, customer's
    decision; live delta vs real dims ≤9 ₽/item) — so the only uncoverable case is a sku with no
    `marketCategoryId`.
  * **`frequency` is never sent**: omitted, Yandex uses the seller's actual payout schedule; a wrong
    value is `400 INVALID_PAYMENT_SETTINGS` («payout frequency WEEKLY and delay weeks null are not
    supported», live). Calculator failure degrades like the returns call: line omitted,
    `ErrorReporter` with `context: 'profit:tariffs'`.
  * **Live spec drift**: `offerIds` filter of offer-mappings takes **≤100** per request
    (`OFFER_IDS_BATCH`) — the spec says 200, the live API answers
    `400 offerIds size must be between 1 and 100`. The filter is mutually exclusive with paging, so
    `getOfferMappings` sends **no** `limit`/`page_token` (pinned by test). `campaignId` goes in the
    **body as a number**; `sellingProgram` is XOR with it and never sent. No caching yet: a report is
    ~2–8 requests against quotas of 600/min (mappings) and 100/min (calculator); калькулятор принимает
    ≤200 товаров за запрос (`TARIFFS_MAX_OFFERS`).
  * `npx ts-node scripts/diagnose-tariffs.ts --user=<id> [--from=DD-MM-YYYY --to=…]` — the read-only
    сверка that answered the gate questions above (leaf-category acceptance, price variant, batch
    behaviour on 400 via bisect, frequency, coverage).
- **Two read-only scripts exist for exactly the questions this report raises** (both boot
  `AppConfigModule + ErrorsModule + YandexModule` only — `AppModule` would start `BotRegistry`, whose bootstrap
  re-points the webhook away from the running bot; `AppConfigModule` must be imported explicitly,
  `@Global()` does not pull a module into a context):
  - `npx ts-node scripts/diagnose-orders.ts --user=<id>` — a day's orders broken down by status via
    **both** date filters (a mismatch between them means the filter loses orders, not that the seller
    is wrong), a 7-day histogram, the token's store list, `--report` (the real report through the real
    services) and `--unknown` (every sku with no purchase price — the message itself lists five).
  - `npx ts-node scripts/load-purchase-prices.ts --user=<id> --file=stock.xlsx` — refreshes purchase
    prices from a price list without going through Telegram. Goes through `StockSyncService.sync` with
    `dryRun: true`, so **no stock is written to Partner API** while our Mongo is updated; upserts never
    delete rows absent from the file.

### Четыре экрана из Partner API: карантин, отзывы, платежи, рекомендации

Все четыре — за своими фичами (`price_quarantine`, `goods_feedback`, `payments_report`,
`price_recommendations`), **все `defaultEnabled: false`** — открываются по одному продавцу из
панели, паттерн `warehouses`/`fby`. Кнопки: «🚧 Карантин цен», «💬 Отзывы», «💳 Платежи»,
«🎯 Рекомендации цен» — два ряда в `MENU_LAYOUT`, у большинства продавцов схлопываются целиком.
Inline-кодеки (`pq:`, `fb:`, `pay:`) — чистые модули рядом со своими доменами
(`quarantine.domain.ts`, `feedback.domain.ts`, `payments.domain.ts`), их разбирает
`requiredFeatures`, а шаги `quarantineCallbacks`/`feedbackCallbacks`/`paymentsCallbacks` стоят в
композере между `reportCallbacks` и `onboardingCallbacks`.

- **«PUT остатков — единственная запись» больше не верно.** Мутирующих операций четыре: тот PUT и
  три POST через **`postWrite`** в клиенте — подтверждение карантина (бот и CRM, через
  `QuarantineService`), ответ на отзыв и
  skip-reaction (бот и CRM, через `FeedbackService`); CRM перед записью сверяется с живым списком,
  чтобы устаревшая вкладка не подтвердила чужую цену и не опубликовала второй ответ. `postWrite` — зеркало `put()`, БЕЗ повторов, и по той же причине: withRetry
  повторяет 5xx/420, а повтор вслепую мог бы опубликовать **два одинаковых публичных комментария**
  на Маркете. Семантически читающие POST (отчёты, каталог, сам список отзывов) остаются на
  `post()` с повторами.
- **Карантин** (`quarantine.handler.ts`) — быстрый экран, без очереди. Цены читаются ТОЛЬКО из
  `verdicts[].params` (поля `currentPrice`/`lastValidPrice` товара deprecated по спеке). Артикул
  (до 255 символов) не лезет в 64 байта callback_data, поэтому при отрисовке список пишется в
  `UserAccess.quarantineOfferIds`, кнопки несут **индекс** (`pq:ok:<idx>` / `pq:all`), протухший
  список отвечает «откройте заново». Список пишется ДО отправки кнопок. Confirm — батчами ≤200
  (лимит спеки).
- **Отзывы** (`feedback.handler.ts`) — быстрый экран; каждый отзыв отдельным сообщением со своими
  кнопками (одна inline-клавиатура на сообщение). Ответ **никогда не публикуется сразу**: текст →
  черновик (`UserAccess.feedbackDraft`) → превью с `fb:send`/`fb:cancel`, публикует только кнопка —
  ответ ПУБЛИЧНЫЙ, случайное сообщение после «Ответить» не должно улетать (довод `dryRun`). Вопрос
  закрывается ПОСЛЕ успешной публикации (упавший запрос сохраняет черновик).
  `pendingFeedbackReply` — **четвёртое pending-поле**, его проверка в `ApiSettingsHandler` стоит
  строго **последней**: три соседних вопроса едят только числа/дату/время, этот — любой текст, и
  раньше он глотал бы их ответы (пиновано `feedback-domain.test.ts` по исходнику). Открытие
  вопроса сбрасывает остальные pending одним `$set` (внутри `setPendingFeedbackReply`).
- **«✨ Предложить ответ» (TASK-167, фича `feedback_ai_reply`, требует `goods_feedback` и `ai`)** —
  `feedback/feedback-draft.service.ts` + чистый `feedback-draft.domain.ts`, ядро на бот и CRM. Один
  запрос `AiService.complete` без инструментов, `purpose: 'feedback-reply'`. ИИ даёт **только
  черновик**: `FeedbackService.reply` сервис не зовёт (пиновано тестом), наружу текст уходит прежним
  превью кнопкой продавца — ответ публичный и без отката, довод `dryRun`.
  - Отзыв **перечитывается с Маркета по id** (`listNeedingReaction`): в `callback_data` текст не
    влезает (64 байта), а тексту от веба верить незачем. Пропал — `FeedbackGoneError`.
  - Промпт запрещает обещать возврат/замену/компенсацию, спорить и обвинять покупателя, упоминать
    конкурентов и цены, выдумывать характеристики товара — **товара в отзыве нет**
    (`FEEDBACK_NO_PRODUCT_NOTE`), модель знает ровно то, что написал покупатель. Просим ≤ 800
    символов (`FEEDBACK_DRAFT_TARGET_LENGTH`), лимит Маркета 4096 проверяет `feedbackReplyProblem`:
    длинный/пустой черновик **не обрезается** (обрезка — чужой текст с оборванной фразой), каналы
    показывают его с просьбой сгенерировать ещё раз или прислать свой.
  - Бот: кнопка под вопросом «пришлите текст» (`fb:ai:<id>`, гейт — обе фичи) только ставит
    `SEND_FEEDBACK_DRAFT` в очередь `reports` (`FeedbackDraftProcessor`, без своего `@OnQueueFailed`):
    Polza отвечала до 68 с, в хендлере это заморозило бы polling для всех. Черновик ложится в
    `feedbackDraft` атомарно, только если вопрос всё ещё про этот отзыв
    (`setFeedbackDraftIfPending`), и показывается прежним превью «✅ Отправить». Черновик в
    `UserAccess` — тот же механизм, что у текста продавца, и стирается закрытием вопроса; в
    `AiUsage` и журналах текста нет (правило TASK-104).
- **Платежи** (`payments.handler.ts` → `SEND_PAYMENTS_REPORT` → `payments-report.processor.ts`; в CRM — kind
  `payments:report`, см. `src/modules/crm/README.md`, «Платежи» и «Отчёты Маркета» в CRM) —
  united-netting через очередь `reports` (generate→поллинг — минуты). **Ключа в `REPORT` нет
  намеренно** (прецедент `PLACED_DEFINITION`): ключ отчеканил бы кнопку периода и строку дайджеста
  для xlsx, бессмысленного в рассылке. Свои периоды `pay:week|month|prevmonth`
  (`paymentsRange`, московский календарь, все ≤3 мес по построению); даты считаются **в
  процессоре** — «с 1 числа» на момент отправки, не постановки. `dateFrom`/`dateTo` (YYYY-MM-DD),
  deprecated `dateTimeFrom/To` не отправлять. `format=FILE` — xlsx Маркета уходит как есть, скоуп
  сужен `campaignIds: [активный магазин]`. DONE без файла = «данных нет» (NO_DATA), не сбой.
- **Рекомендации** (`price-recommendations.handler.ts` → `SEND_PRICE_RECOMMENDATIONS`) — очередь
  (квота метода 100/мин, десятки секунд). Два фильтрованных прохода `competitivenessFilter:
AVERAGE|LOW` вместо обхода каталога. Ответ уже несёт текущую цену (`offer.price`) — **сверка с
  offer-prices не нужна**. Дельта `price − optimalPrice`; нет цены или порога → `null`, не ноль
  (довод `orderPurchase`), строка уходит в «без данных». Всегда xlsx (довод FBY), момент среза в
  тексте и имени файла. Фича чисто читающая; follow-up вне скоупа — «применить рекомендованную
  цену» через `offer-prices/updates`.
- **Загрузка, порядок строк/сводка и книга рекомендаций и карточек — в сервисах `YandexModule`**
  (`RecommendationsService`, `CardsService`, TASK-085): процессоры бота зовут их, у бота остались
  только тексты и отправка (текст + файл); CRM зовёт те же сервисы (таблица + тот же файл; см.
  `src/modules/crm/README.md`, «Рекомендации цен» и «Карточки» в CRM).
- Оба новых процессора: payload `botId`/`chatId`/`telegramUserId` **без токена**, креды из Mongo,
  **без второго `@OnQueueFailed`**, дедуп `isQueuedFor` по своему имени джобы, фича в процессоре не
  перепроверяется (довод fby-overview).
- Версии путей всех четырёх методов проставлены `v2` **по аналогии** — на боевом ещё не сверены
  (как в своё время сверяли stocks-report). При первом включении фичи проверить и обновить
  комментарий в `yandex-api.paths.ts`.

### Второй заход: раздел отчётов, глубокая история, поставки FBY, карточки

Ещё четыре фичи, все `defaultEnabled: false`: `market_reports`, `offer_cards` (кнопки
«📈 Отчёты Маркета» и «🪪 Карточки», третий default-off ряд `MENU_LAYOUT`), `deep_history` и
`fby_supply` (**без кнопок** — inline-only подписи в `FEATURE_META`, паттерн `PROMOTION`: первая
меняет поведение существующих отчётов, вторая — секция внутри «📦 FBY»). Кодек `mkt:` — в
`market-reports.domain.ts`, шаг `marketReportsCallbacks` в композере; `deep_history`/`fby_supply`
гейтом не разбираются — читаются в `run`/хендлере и едут в payload (паттерн `tariffEstimate`).

- **«📈 Отчёты Маркета» — шесть асинхронных отчётов за ОДНИМ флагом** (в CRM — kind-ы `market-reports:<key>`) (решение продуктовое), все
  `format=FILE` → готовый xlsx Маркета с caption (паттерн «Платежи»), один job
  `SEND_MARKET_REPORT`, один `market-report.processor.ts`, один универсальный
  `client.generateReport(path, body)`. **Параметры разнородны** (проверено по спеке) — общего
  пикера периода нет, у каждого отчёта своя цепочка кнопок через showMenu/editMessageText (паттерн
  `schedule.handler`, НЕ pendingRate): реализация — `{campaignId, year, month}` (два последних
  ЗАВЕРШЁННЫХ месяца); оборачиваемость — `{campaignId}` без параметров и **только FBY** (пункт
  скрыт у не-FBY по кэшу stores + перепроверка на тапе); конкуренты —
  `{businessId, categoryId, dateFrom, dateTo}` все обязательны; аналитика продаж — период +
  `grouping: CATEGORIES|OFFERS`; ключевые показатели — только `detalizationLevel: WEEK|MONTH`
  (дат нет); география — `{businessId, dateFrom, dateTo}`. Периоды переиспользуют
  `paymentsRange`/`PAYMENTS_PERIOD_LABELS` (импорт, не копия). **Квота 10/час у comp и shows** —
  на `YandexRateLimitError` процессор отвечает `mktRateLimitText`, не общей ошибкой. Пикер
  категории (comp) — `MarketCategoriesService.topCategories`: обход offer-mappings с
  `mapping.marketCategoryName`, мемо по businessId TTL 10 мин (без single-flight — лимита 1/мин
  тут нет). Даты в payload НЕ едут — период ключом, даты считает процессор на момент отправки.
- **Общий поллер `report-poll.ts`** (`pollReportFile`: DONE без файла → null «данных нет»,
  FAILED/таймаут → throw) — потребители: платежи, раздел отчётов и импорт финансового журнала
  (`finance-import.service.ts`). `fby-stock.service` остаётся на своём цикле НАМЕРЕННО: у него поверх
  мемо и single-flight под лимит генерации (сейчас 1 за 2 минуты, см. «Warehouses»).
- **`deep_history`: архив `POST /v2/campaigns/{id}/stats/orders`, а НЕ мифический
  `/v1/businesses/{id}/orders`** — того эндпоинта в спеке НЕ существует, декларация
  `businessOrdersPath` удалена. Скоуп: ✅ `redeemed`/`profit` (updatedAt → `updateFrom/To`),
  ✅ `tariff_calc` (creationDate → `dateFrom/To`); `shipped_today` — частично: конкретные периоды
  ❌ остаются в 30-дневном окне (у stats нет фильтра даты отгрузки), но «Всего» — срез «в пути»
  `DELIVERY+PICKUP` — идёт через архив **без дат вовсе**, так что ограничение его не касается
  (маршрут `usesArchive` в `order-reports.service.ts`, дискриминатор — `unboundedStatuses` в
  определении); ❌ `returning` (нет подстатусов) — честно остаётся в 30 днях и под флагом.
  - **Форма заказа другая** (`OrdersStatsOrderDTO`) — маппер `reports/stats-orders.ts`:
    статусы через `Record` по полному enum (`CANCELLED_*` → CANCELLED, `LOST` → UNKNOWN,
    **`PARTIALLY_DELIVERED` → PARTIALLY_RETURNED** — денежно-безопасное направление, не завышать
    прибыль); позиция `offerName === 'Доставка'` уходит в `deliveryTotal` и не в items;
    `itemsTotal` = Σ BUYER-итогов позиций; из позиционных CASHBACK/MARKETPLACE синтезируются
    ЗАКАЗНЫЕ subsidies; верхнеуровневые subsidies архива НЕ читаются (баллы размещения). Поле
    итога цены читается **bracket-доступом** `price['total']` — тест запрещённых денежных полей
    ловит `.total` текстом, а здесь другой DTO с легитимным полем того же имени (по этой же
    причине `ICardsSummary.totalCards`, не `total`).
  - **Роутинг в `collectOrders`**: период, начинающийся глубже 30 дней, при флаге идёт через архив
    ЦЕЛИКОМ (не сшивать источники — формы расходятся системно); `assertPeriodSupported` под
    флагом заменяется на выделенную из неё `assertPeriodOrdered`; `periodWindows`/дедуп/
    `matchesDefinition` общие для обоих путей. Статусы фильтра — `toStatsStatuses` от ПОЛНОГО
    определения (у архива свой enum, шире `QUERYABLE_STATUSES`). Задержка данных архива до 40 мин.
  - **Правило включения: `scripts/diagnose-deep-history.ts` — числа сходятся ДО РУБЛЯ**, иначе
    флаг не открывается никому (прецедент июльской сверки). Скрипт гоняет один 30-дневный период
    через оба метода: составы по статусам с id расхождений, Σ денег/субсидий, граничный день,
    доля PARTIALLY_DELIVERED, проба 60-дневного интервала.
  - Флаг едет: `IProfitReportJob.deepHistory`/`ITariffReportJob.deepHistory`, опции
    `OrderReportsService.build`/`collectPlacedOrders`/`ProfitService.build`/`buildTariffReport`;
    предупреждение «не старше 30 дней» в `askDay` меняется на «можно и старше» только у
    deep-capable отчётов.
- **`fby_supply`**: второй safe-вызов `loadSupplyRequests(['SUPPLY'])` ТОЛЬКО при флаге (флаг
  управляет трафиком); `IFbyOverviewJob.supplySection` — паттерн tariffEstimate, старые джобы без
  поля → «выключено». В `IFbyOverviewData.supplies` **тройная семантика**: `undefined` — фича
  выключена, секции нет; `null` — сбой, заглушка; массив — секция (между заявками на вывоз и
  countsLine). Дата поставки — только `targetLocation.requestedDate` (deliveryDate-полей в DTO
  нет), транзит xDoc — `transitLocation.name`; терминальные FINISHED/CANCELLED не в списке, а
  хвостом «Завершённых/отменённых: N». Своя таблица подписей `SUPPLY_INBOUND_STATUS_LABEL` —
  не смешивать с вывозной.
- **`offer_cards`** — калька price_recommendations: `loadOfferCards()` (полный POST-обход, тело
  `{}` — `offerIds` несовместим с фильтрами), `cards.domain.ts` (9 статусов + 17 рекомендаций
  по-русски, fallback сырым кодом), сводка «статусы с действием первыми» + средний рейтинг против
  `averageContentRating` + топ-10 слабых, всегда xlsx.
- Новые версии путей (`ordersStats`, `offerCards`, шесть generate на `reports`) — `v2` по
  аналогии, «сверить на боевом при первом включении».
