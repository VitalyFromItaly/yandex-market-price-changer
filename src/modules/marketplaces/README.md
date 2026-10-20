# Площадки: подключения и адаптеры (M19, TASK-127, TASK-162, TASK-163)

Ozon и Wildberries должны ложиться в те же журнал, товары и заказы, что и Яндекс Маркет, а не в
их копии (решение `tz_finance_scope`). Этот модуль даёт для этого три вещи: общий список площадок,
подключения (`MarketplaceConnection`) и реестр адаптеров (`MarketplaceRegistry`). Правила и их
причины — ниже, в одном месте.

## Доводы и история решений

> Перенесено из корневого `CLAUDE.md` (2026-10-18) и слито с прежними правилами этого README: каждый
> факт записан один раз, вместе с причиной.

### Площадки: `MarketplaceConnection` и адаптер (M19, TASK-127)

Решение `tz_finance_scope` отменило `crm_marketplaces` («только каркас»). Ozon и WB встают в те же
журнал, товары и заказы через одну абстракцию: `src/modules/marketplaces/`.

- **Список площадок один: лист `src/shared/marketplace.ts`** (`TMarketplace`, `MARKETPLACES`,
  `MARKETPLACE_LABEL`, `isMarketplace`; лист без импортов). `product.domain.ts` его реэкспортирует,
  `FINANCE_MARKETPLACES` — его подмножество (`satisfies`). Фронт держит копию в
  `web/crm/src/navigation.ts` (`ALL_MARKETPLACES`), и `marketplaces.test.ts` читает её как текст и сверяет
  ключи с подписями. Две несвязанные копии — это ровно та пара, что расходится молча.
- **Креды ЯМ не переехали** (решение владельца `marketplace_connection_ym_virtual`).
  `MarketplaceConnection` (Mongo, unique `telegramUserId + marketplace`) хранит только Ozon/WB, а
  подключение ЯМ собирается из `YandexMarket` при чтении (`connectionsView`). Перенос значил бы правку
  ~50 файлов (37 — бот) и миграцию. Копия токена рядом с оригиналом разошлась бы при первой смене в
  CRM, а бот и все отчёты читают `YandexMarket`.
- **Креды в схеме `select: false`, читать их может только `MarketplaceConnectionService.credentialsOf`**,
  а остальные методы возвращают строку, собранную перечислением полей. Поэтому ответ не может нести
  ключ по забывчивости: HTTP-тест кладёт ключи в базу (модель в памяти `select` не соблюдает) и
  проверяет, что в ответе их нет. Неудачная проверка ключа ничего не пишет: неверный ключ не перетирает
  рабочий (TASK-128).
- **Адаптер — чистая делегация к сервисам бота**, ни одного числа не пересчитывает. Тест сравнивает
  результат с обёрнутым сервисом (`toBe`). `YmMarketplaceAdapter` зовёт те же сервисы, что бот и CRM:

  - `orders.listOrders` → `OrderReportsService.collectPlacedOrders` + `ymMarketplaceOrder`
  - `finance.importFinance` → `FinanceImportService.importAndRecord` (у Ozon —
    `OzonFinanceService.importPeriod` → `importBatchAndRecord`)
  - `catalog.listProducts` → `loadCatalogProducts` + `productRowsFromCatalog`
  - `stocks.listStocks` → `StockLevelsService.levels` + `ymStockLevels`
  - `connection` — отдельная часть, `YmConnectionAdapter` поверх `StoresService.recheckToken`

  `OzonMarketplaceAdapter` так же делегирует `OzonCatalogService` (`ozonCatalogRows`,
  `ozonMarketplaceStocks`), `OzonOrdersService` и `OzonFinanceService`, `WbMarketplaceAdapter` —
  `WbCatalogService`, `WbOrdersService` и `WbFinanceService`; нет ключа —
  `MarketplaceNotConnectedError` (`no-credentials`). Общий формат заказа и товара заранее не
  придумывался: формат по одной площадке совпал бы с ней. Его вывели по ЯМ и Ozon (TASK-130, TASK-163).

- **В адаптер идёт ссылка `{telegramUserId, marketplace, campaignId?}`, не креды** — довод «payload
  без токена»: адаптер сам перечитывает ключи. ЯМ перечитывает документ на каждый вопрос (потребитель
  задаёт один) и сужает его `scopeStore`; импорту финансов документ не нужен вовсе. Активный магазин
  открыт и у старого документа без кэша `stores`.
- **Адаптер — набор возможностей, а не сессия** (TASK-162, решение `marketplace_adapter_steps`):
  `connection`, `finance`, `orders`, `catalog`, `stocks` (`IMarketplaceCapabilities`), каждая
  регистрируется отдельно. Нет поля — нет возможности. Монолитная сессия из четырёх методов была
  несовместима с `ozon_adapter_after_finance`: Ozon либо не регистрировался вовсе — и «Подключения»
  жили сбоку от реестра `switch`-ем по площадкам и списком `CONNECTABLE`, — либо бросал бы «не
  реализовано» из `importFinance` под ночной загрузкой. Пока у Ozon не было финансов,
  `require('ozon', 'finance')` отвечал `MarketplaceNotConnectedError` (`no-adapter`). Сейчас все пять
  возможностей зарегистрированы у всех трёх площадок: у ЯМ (подключение — отдельной частью), у Ozon —
  подключение, каталог, остатки (TASK-163), заказы (TASK-130) и финансы (TASK-131), у WB — подключение,
  каталог, остатки (TASK-134), заказы (TASK-135) и финансы (TASK-136).
  - Дверь к площадкам — `MarketplaceRegistry`: `capability(mp, cap)` — реализация или null,
    `require(mp, cap)` — то же с отказом `MarketplaceNotConnectedError` (`no-adapter`),
    `withCapability(cap)` — список площадок.
  - Части одной площадки реестр складывает (`capabilityTable`; подключение ЯМ — отдельный
    `YmConnectionAdapter`, ему нужен только `StoresService`), одна возможность дважды — ошибка
    сборки. `supported()` (есть данные) и `connectable()` (есть подключение) выводятся из таблицы, а не
    пишутся руками.
- **Через реестр ходят:**

  | Потребитель                                                         | Возможность                                                                       |
  | ------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
  | процессор очереди `finance-import`, `scripts/import-finance.ts`     | `finance`                                                                         |
  | kind-ы CRM `stocks:by-sku`, `overview:stocks`, `forecast:purchases` | `stocks`, магазин — кампанией (`ymStocks` в `crm/jobs/crm-marketplace-stocks.ts`) |
  | kind CRM `inventory:summary` («Склад»)                              | `stocks` всех площадок, `orders` Ozon/WB                                          |
  | `StockPushService` (`src/modules/stock-push/`)                      | `stocks`, `orders`                                                                |
  | «Подключения» (`MarketplaceConnectionsService`)                     | `connection`                                                                      |
  | `scripts/sync-ozon-catalog.ts`                                      | `catalog`, `stocks` Ozon и WB                                                     |

  Адаптеры `MarketplacesModule` не экспортирует (наружу — только реестр и сервис подключений), а
  `marketplace-boundaries.test.ts` текстом пиннит, что `finance`, `crm`, `products` и (с TASK-163)
  `scripts/` не импортируют клиентов Ozon/WB и адаптеры. Отчёты бота и `orders:*`/`profit:*` не
  тронуты: их числа сверены с кабинетом, и задача прямо запрещала их переписывать. Заказы и финансы
  Ozon/WB — с TASK-130/131/134–136.
  `ProductSeedService` ходит в каталог сам: его скрипт поднимает только `YandexModule`, а через адаптер
  пришлось бы поднимать и Postgres.

- **Каталог и остатки — наши сущности, а не псевдонимы ЯМ** (TASK-163). Карточка — `IMarketplaceProduct`,
  та самая строка `IProductCatalogRow`, что принимает `ProductMatchService.syncCatalog` (плюс
  `archived`): потребитель не знает формы ответа площадки, и маппер под площадку ему не нужен.
  Остатки — `IMarketplaceStockLevels` с `byLocation.seller` (склад продавца: FBS/DBS/Express ЯМ, FBS
  Ozon и WB) и `byLocation.marketplace` (склад площадки: FBY ЯМ, FBO Ozon, FBW WB) **раздельно и без суммы**
  (правило FBY read-only, `src/modules/yandex/README.md`: FBY ЯМ и FBO Ozon — чужой склад). Количество —
  `{available, reserved}`. ЯМ кладёт свою кампанию ровно в одно место (`ymStockLevels`, резерв `null` —
  не сообщает), Ozon — оба (`ozonMarketplaceStocks`, доступно = present − reserved), WB — тоже оба
  (`wbMarketplaceStocks`: FBW — склад площадки, FBS — продавца, резерв `null`). Нет остатков —
  пустой `byLocation` и `error` (`rate_limit`/`generic`, те же коды, что у отчёта FBY). kind-ы CRM
  читают `availableBySku(levels, location?)` (`marketplace-stocks.ts`) — без места он берёт
  единственное непустое (кампания ЯМ), а при двух бросает: смешанного числа не бывает. Числа ЯМ в CRM
  не изменились, тесты гоняют старые снимки через тот же маппер. Ozon зарегистрировал
  `catalog`/`stocks`, `scripts/sync-ozon-catalog.ts` ходит через реестр (и поэтому поднимает Postgres,
  как финскрипты).
- **Заказ — наша сущность** (TASK-130), `IMarketplaceOrder`, выведенная по ЯМ и отправлениям Ozon:
  строка — то, что площадка отгружает одним номером (заказ ЯМ, отправление Ozon, штука WB), этап — из
  общего набора ТЗ п.11 (`src/shared/order-stage.ts`), продажи — рубли или `null`. ЯМ переводится
  `ymMarketplaceOrder` из функций отчётов (`orderTotals`, `ymOrderStage`, `orderDayIso`), Ozon —
  `ozonMarketplaceOrder`, WB — `wbMarketplaceOrder`. Почему так — `src/modules/ozon/README.md`, «Ozon: отправления и общий
  заказ».
- **`MarketplacesModule` — отдельный модуль.** `FinanceModule` уже импортирует `YandexModule`, и
  адаптер внутри Yandex замкнул бы цикл. `MarketplacesModule` импортирует оба, обратно стрелок нет.
- **CRM: `GET /api/crm/marketplaces`** — три площадки, ответ без кредов и id:

  - `connected` — подключена ли площадка;
  - `status` — `none` значит «не подключали», `rejected` / `unavailable` значат «ключ есть, но
    не работает»;
  - `accountCount` — сколько магазинов или кабинетов;
  - `available` — можно ли площадку подключить или она уже работает (`availableMarketplaces`):
    данные или подключение в реестре, и при этом открыта фича площадки (`ozon`, `wb`). Закрытая фича —
    «скоро»: иначе «Обзор» звал бы «подключить» туда, где гейт ответит 403.

  Фичи у адреса нет: это навигация, а не функция.

- **Контроллеры площадок — каждый под своим сегментом.** Контроллеры `crm/ym/*` остаются, у Ozon/WB
  свои `crm/ozon/*` (подключение ключа, `src/modules/ozon/README.md`), `crm/wb/*` (решение
  `crm_marketplace_api_segment`): формы данных разные, а общий `crm/:mp` заставил бы каждый контроллер
  ЯМ отсекать чужие площадки в рантайме. На фронте префикс тоже буквальный у каждой площадки. `/ozon` и
  `/wb` были адресами страницы «скоро»; с TASK-161 это редиректы на `/connections` (раздел ниже), а
  страница «скоро» осталась у прочих адресов под ними. Площадка из адреса — `useMarketplace()`.

### «Подключения» в CRM (TASK-161)

Раздел аккаунта `/connections`: карточка на площадку — статус, маска ключа, когда ключ последний раз
подтвердила площадка, что она сказала при отказе, какие магазины открывает. Две кнопки: «Проверить
связь» и «Заменить ключ». Бэкенд — `src/modules/crm/connections/` поверх
`MarketplaceConnectionsService.cards/check` (`GET /api/crm/connections` — карточки с маской ключа,
`checkedAt`, `checkError`, магазинами; `POST /api/crm/connections/:marketplace/check` — повторная
проверка записанного ключа), фронт — модуль `web/crm/src/modules/marketplaces/`.

- **Зачем экран, если обе формы уже были.** Владелец считал, что ключ задаётся только в Telegram и
  только для ЯМ. Форма токена ЯМ стояла внизу «Магазинов», а продавца с одним магазином эта страница
  сразу перекидывает в магазин. Подключение Ozon жило на своей странице под выключенной фичей.
  Нигде не было видно, какой ключ стоит и работает ли он.
- **ЯМ — без фичи, Ozon и WB — под своими** (решение `crm_connections_screen`). Смена токена ЯМ была
  открыта всем ещё на «Магазинах», так что это перенос функции, а не новая. Карточка закрытой
  площадки приходит «скоро», без формы. Проверка её ключа отвечает 403 тем же `assertFeatures`, что
  стоит за `@RequireFeature`: фича зависит от площадки в адресе, а декоратор её не знает.
- **«Проверить связь» ключ не меняет ни в одном исходе.** У ЯМ это `StoresService.recheckToken`: успех
  обновляет кэш `stores` и новое поле `YandexMarket.tokenCheckedAt`, активный магазин бота не
  трогается. У Ozon/WB — `verify` площадки и `MarketplaceConnectionService.markChecked`. Он пишет
  статус, `checkedAt` и `checkError`, креды не трогает.
- **Недоступность площадки не записывается.** О ключе она ничего не говорит, а записанная превратила
  бы рабочее подключение в «не подключено» до следующей проверки. Это довод самопроверки
  (`src/modules/health/README.md`, «Self-checks»).
- **У ЯМ статуса в базе нет** (`marketplace_connection_ym_virtual`): записанный токен считается
  проверенным. Поэтому отказ при проверке ЯМ виден в ответе и тосте, а после перезагрузки карточка
  снова «подключён». Чинится это заменой токена, а не флагом рядом с ним.
- **Маска — `maskKeyHint`**: точки и последние 4 символа, ключ короче 12 символов — одни точки.
  Креды Ozon/WB читаются только через `credentialsOf` ради маски. Секретное поле площадки задаёт
  её коннектор (`IMarketplaceConnector.secretField`), «Проверить связь» — его `check`: ветвлений по
  площадкам в `MarketplaceConnectionsService` нет (TASK-162). Запись итога у Ozon и WB одна —
  `checkStoredConnection`. HTTP-тест проверяет, что ни ключа, ни
  `campaign_id`/`business_id` в ответах нет.
- **Замена ключа остаётся на маршрутах площадок** (`PUT crm/ym/stores/token`, `PUT
crm/ozon/connection`), решение `crm_marketplace_api_segment`. Экран после замены перечитывает
  карточки и список площадок сайдбара: ответы замены разной формы, а маски и даты в них нет.
- **Раздел `ozon-connection` удалён**, фича `ozon` ушла в `FEATURES_WITHOUT_SECTION`. `/ozon`,
  `/ozon/connection` и `/wb` — редиректы на `/connections`.
