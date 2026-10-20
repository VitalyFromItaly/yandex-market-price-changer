# Инструменты ИИ (`AiToolsModule`, TASK-147)

Функции, которые модель вызывает через `AiService.completeWithTools`: она спрашивает данные, а не считает их
сама (решение `ai_explains_not_computes`). Вверху — таблица инструментов и пример вызова; правила и причины —
ниже, «Доводы и история решений».

| Инструмент            | Аргументы                                                               | Откуда                                                              |
| --------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `getPnl`              | `from`, `to`, `marketplace?`                                            | `FinanceService.build(…, {flat: false})`                            |
| `getSkuEconomics`     | `sku`, `from`, `to`                                                     | `pnl.skus` того же расчёта + имя из `Product`                       |
| `searchProducts`      | `query`, `limit?` (≤ 20)                                                | `ProductService.search` — слова запроса по названию и артикулам     |
| `getTopSkus`          | `from`, `to`, `by`, `order?`, `limit?` (≤ 20), `lossOnly?`              | `pickTopSkus` — строки `pnl.skus` того же расчёта                   |
| `getBrandEconomics`   | `brand?`, `from`, `to`                                                  | `brandEconomicsOf` — свёртка `pnl.skus` по `brandOf` товаров        |
| `compareMarketplaces` | `from`, `to`                                                            | `FinanceService.compare` — та же дверь, что «Сравнение площадок»    |
| `listAnomalies`       | `month`, `unreviewedOnly?`                                              | `FinanceScreenService.anomalies`                                    |
| `getOperations`       | `ids` (≤ 50)                                                            | `FinanceScreenService.operationsByIds`                              |
| `getForecast`         | `basisDays?` (14/28/56)                                                 | `FinanceForecastService.build` — та же дверь, что экран «Прогнозов» |
| `getCashflow`         | `month`                                                                 | `FinanceCashflowService.build` — вкладка «Деньги» «Финансов»        |
| `getTaxYear`          | `year?`                                                                 | `FinanceTaxYearService.build` — раздел «Налоги», прогноз помечен    |
| `getPriceFor`         | `sku`, `targetProfitRub?` \| `targetMarginPercent?`, `discountPercent?` | `PriceCalcRatesService.forSku` + `priceFor`/`profitAt`              |
| `getExpenses`         | `from`, `to`                                                            | `FinanceExpensesService.allocatedFor` — то, что вычитает P&L        |
| `getStocks`           | `brand?`, `query?`, `onlyLow?`, `store?`                                | `StockLevelsService.levels` — живой Маркет, раздел «Склад»          |
| `getReturns`          | `period?` (today/week/month/all), `store?`                              | `OrderReportsService.build(RETURNING)` — «Едет обратно»             |

Инструмент экрана виден модели только при открытой фиче экрана — таблица `AI_TOOL_FEATURE`
(`ai-tools.domain.ts`): `getForecast` — `forecast`, `getCashflow` — `finance`, `getTaxYear` — `tax_year`,
`getPriceFor` — `price_calculator`, `getExpenses` — `expenses`, `getStocks` — `inventory`, `getReturns` —
`report_returning`. Новый инструмент экрана — новая строка таблицы.
`compareMarketplaces` виден всегда, а фичи площадок (`AI_MARKETPLACE_FEATURES` — `ozon`, `wb`, входят в
`AI_GATED_FEATURES`) решают, какие площадки он читает: закрытая приходит строкой с причиной.

```ts
// продавец — только здесь; features — открытые фичи из AI_GATED_FEATURES
const toolbox = aiTools.toolbox(telegramUserId, undefined, {
  features: new Set([FEATURE.TAX_YEAR]),
});
await ai.completeWithTools(
  { telegramUserId, aiAllowed, purpose: 'analyst' },
  { messages },
  toolbox,
);
```

## Доводы и история решений

> Перенесено из корневого `CLAUDE.md` (2026-10-18), чтобы он не грузил в каждую сессию то, что нужно
> только при работе в этом модуле. Сюда же слиты правила, которые раньше повторялись в верхней части
> README; вверху остались только таблица инструментов и пример вызова.

**AI tools (`src/modules/ai-tools/`, M24, TASK-147) — the model asks for numbers, it does not make them**
(decision `ai_explains_not_computes`). `getPnl`, `getSkuEconomics`, `searchProducts`, `getTopSkus`, `getBrandEconomics`, `compareMarketplaces`, `listAnomalies`,
`getOperations`, `getForecast` (TASK-151, only when the seller's `forecast` feature is open); read-only, through the doors the screens use (`FinanceService.build` with `{flat: false}`,
`FinanceScreenService`), no formula of their own: numbers are fields of the P&L engine and the journal. The tool
table is at the top of this README.

- **Brands are a tool, not a question to the seller.** With only `getSkuEconomics` (one exact offerId) and a prompt
  saying «don't know the sku — ask», «how much did I make on Casio» became an endless round of «which article?».
  `getBrandEconomics` folds the same `pnl.skus` rows by `brandOf` (`finance/pnl-brand.ts`, Σ brands = Σ skus by
  construction); the prompt now sends brands there and answers «all marketplaces» with YM plus one line about Ozon/WB.
  Бренд выводится из названия и категории товара (как в «Аналитике продаж» — `src/modules/crm/README.md`,
  «Аналитика продаж»), путь — `src/modules/finance/pnl-brand.ts`. Без `brand` — все бренды без товаров внутри, с
  `brand` — топ-10 товаров. Заказы бренда — `ordersSumBySku`: сумма по товарам, заказ с двумя товарами бренда
  посчитан дважды.
- **A product name is a search, and «which products lose money» is a ranking** (TASK-164, same live conversation:
  на «сколько заработал на F-91W» модель требовала offerId, на «какие товары убыточные» ей было нечем ответить).
  `searchProducts` (`ProductService.search`: every word of the query must match one of name / internalSku /
  vendorCode / YM sku, `escapeRegExp`, scoped by the closure's seller) turns «F-91W» into YM skus for
  `getSkuEconomics`; a product with no YM card comes back with `sku: null` rather than being hidden. Its result has
  empty `sourceRefs` — a lookup is not money (это справочник), and `sourcesOf` drops empty refs. `getTopSkus` ranks the very rows of
  `pnl.skus` (`pickTopSkus`, tested equal to `getSkuEconomics` to the kopeck). The `sku-ratings` rule holds: a row
  with `costKnown: false` is out of the net/margin ranking and out of `lossOnly` — its net is inflated, a place in
  «most profitable» would be fiction — and the count travels as `excludedNoCost`; revenue/units keep it. Nothing
  to rank is `insufficientData` naming that count, not an empty list. The prompt no longer asks for a sku at all.
- **The seller lives in the closure, never in the arguments.** `AiToolsService.toolbox(uid)` is the only place
  it enters; no schema has a seller field, and an extra argument (`telegramUserId`) is refused rather than
  ignored — `additionalProperties: false` is a request to the model, not a guarantee, and the seller's own text
  can talk the model into anything. Every call below is already scoped (`liveForPnl`, `byIds` filter by seller).
- **`getForecast` is in the set only when the seller's `forecast` feature is open**; `call` refuses a hidden name
  as unknown — a hidden definition does not stop the model from naming it. Its `sourceRefs` are the operations of
  the forecast's base window.
- **Каждый инструмент экрана — за фичей своего экрана** (TASK-165, решение `ai_tools_by_screen_feature`,
  обобщение `forecast_ai_by_feature`): `AI_TOOL_FEATURE` → `hiddenAiTools(features)`; вызывающий передаёт
  `toolbox(uid, now, {features})` — открытые фичи из `AI_GATED_FEATURES`, уже развёрнутые `isFeatureEnabled`
  (зависимости и админ). Довод: ИИ не открывает продавцу экран, который ему закрыт в навигации. Промпт
  аналитика тоже собирается по видимым инструментам — строка о скрытом инструменте подсказала бы его имя.
- **Сравнение площадок — `FinanceService.compare` (TASK-173, решение `ai_compare_via_finance_compare`).** Раньше
  инструмент строил один `build` ЯМ, а Ozon/WB отдавал `insufficientData` (`FINANCE_READY`), хотя экран «Сравнение
  площадок» уже сравнивал все три. Теперь одна дверь: открытые площадки (`openFinanceMarketplaces(features)` — то же
  правило, что `isMarketplaceFeatureOpen`) → `compare` → `compareResult(FINANCE_MARKETPLACES, …)`. Поэтому числа
  модели = колонке экрана до копейки (тест в `crm-marketplace-compare.test.ts`), а правила учёта сравнения — налог
  по начислению у всех, опер. расходы по доле выручки, «предварительное» — едут строками `rules` (тексты
  `marketplace-compare.ts`), и модель их оговаривает: налог и чистая здесь отличаются от `getPnl`. Закрытая
  площадка — `MARKETPLACE_CLOSED_TEXT`, без журнала — `pnlInsufficiency`; данных нет ни у одной — `insufficient`
  целиком. `sourceRefs.source` — `finance:compare`. `FINANCE_READY` остался только у `getPnl`.
- **Деньги, налоги, цена, расходы — те же двери, что экраны (TASK-165).** `getCashflow` —
  `FinanceCashflowService.build` + подписи категорий `labelResolver` (перенесён из CRM в
  `finance/expense.domain.ts`); «к получению» — на сегодня (`receivable.asOf`), не на конец месяца;
  `sourceRefs` — операции выплат по статьям. `getTaxYear` — `FinanceTaxYearService.build`, прогноз —
  `forecast.kind: 'прогноз'`. `getPriceFor` — ставки строки «Калькулятора цен» (`PriceCalcRatesService.forSku`:
  товар без продаж в окне — средние аккаунта и закуп из прайса, `calcSkuWithoutSales`), цена — `priceFor`,
  разложение — `profitAt` из `src/shared/price-calc.ts`; скидки брендов — документ магазина по
  `findByTelegramUser` (поля уровня аккаунта). `getExpenses` — `allocatedFor`, по категориям с подписью.
- **«Журнал не загружен» для ДДС и налогового года — `FinanceService.monthStatuses`.** Ни `cashflowOf`, ни
  `FinanceTaxYearService` статуса месяца не несут: без журнала они честно вернут нули. Поэтому инструмент сам
  спрашивает статусы: ни одного загруженного месяца — `insufficientData`; часть — `monthsNotLoaded` в данных
  налогового года, модель обязана оговорить. `getPriceFor`: нет ставок (за 30 дней ни продаж товара, ни
  аккаунта), нет закупа, нет решения — причина словами `PRICE_CALC_FAILURE_TEXT` (одна таблица с экраном CRM).
- **A numeric answer cannot exist without `sourceRefs`** — the result is a union (`IAiToolResult`:
  `{ok: true, data, sourceRefs}`, `{insufficientData: true, reason}` or `{error}`), and `ok: true` requires them:
  `source`, period, the first `MAX_REF_IDS` (50) operation ids and the full count, document ids for operations.
  All ids of a month's article are thousands; in the answer they would eat the model's context and the owner's
  money. Drilling further is `getOperations` (≤ 50).
- **No data is `insufficientData` with a reason, never zeros.** A zero is retold to the seller as «убыточный
  месяц». Covered: no journal for any month of the period, a loaded but empty one, a sku absent from the
  breakdown, a month never checked for anomalies (an empty list would read as «всё чисто»), operations not
  found, `getPnl` for Ozon/WB (`FINANCE_READY` — it reads the YM journal), and in `compareMarketplaces` a
  marketplace whose feature is closed or whose journal is not loaded — an `insufficientData` entry next to the
  others' numbers.
- Money is `{kopecks, rub}` with `rub` a two-decimal string, so the model retells a number instead of dividing
  by 100 itself; quality flags travel with the numbers (`statusLabel`, `costComplete`/`costKnown`,
  `taxIsDefault`) — a TASK-148 answer has to caveat an unverified month or incomplete cost (incomplete cost means
  the profit is inflated).
- Bad arguments or an unknown tool are `{error}` for the model; a database failure goes to `ErrorReporter` with
  the new source **`ai`** (`context: ai-tool:<name>`) — not `polza`: Polza did not fail — and the model gets
  `{error}` without details.
- **No feature key of their own** (decision `ai_tools_no_feature`): the tools are not a screen — when they shipped there was
  no caller at all; the barrier is `aiAllowed` in `AiService`, and the function that calls them carries its own
  key with `requires: [FEATURE.AI]`. Сейчас вызывающий — «ИИ-аналитик» (`src/modules/ai-analyst/`, TASK-148) с
  ключом `ai_analyst` (`requires: [ai, finance]`).
- `parseDayRange`/`MAX_RANGE_DAYS` moved from `crm/finance/crm-finance.domain.ts` to `finance-period.ts`
  (re-exported there): logic does not live in `crm/`, and the tools validate model-supplied periods with it.
- **Живые инструменты Маркета (TASK-166): `getStocks`, `getReturns`.** Ходят в Partner API (секунды–минуты,
  квоты на токен), поэтому правила свои:
  - Числа — только сервисы экранов: остатки — `StockLevelsService.levels` (FBY — через мемо и single-flight
    `FbyStockService.safeLoad`; `load()` напрямую не зовётся), возвраты — `build(store, RETURNING, now, period)`,
    тот же вызов, что у бота и `exportReturning`. `collectReturns` остаётся приватным; своей формулы нет.
    У магазина одна модель (FBS **или** FBY, поле `model`), остатки площадок не складываются.
  - Магазин — аргументом `store` по **названию** из кэша `stores` токена (решение `ai_live_tools_store_by_name`):
    номер кампании продавцу не показывается, а модель повторяет аргументы в ответе. Название → `campaignId` →
    `scopeStore` (тот же, что магазин из адреса CRM): чужая кампания не открывается, два магазина с одним
    названием — отказ, а не первый попавшийся. Без аргумента — активный магазин бота. Ответ несёт `store` и
    `stores`, чтобы модель могла переспросить.
  - Сбой Маркета — текст бота: `YandexApiError` → `reportErrorMessage` (лимит, токен, сеть), недоступные остатки —
    `fbyStockUnavailableLine` без значка. Пишется в `ErrorReporter` с `source: 'yandex'` и
    `context: ai-tool:<имя>` — точный context, иначе повтор пары «тип + context» за 15 минут склеит алерты разных
    инструментов. `levels()` не бросает и пишет сам (`crm:stocks`).
  - Время — потолок раунда `AI_TOOL_ROUND_TIMEOUT_MS` в `AiService` (README ai): сверх него модель получает
    честный отказ, а запрос Маркета не отменяется — следующий вопрос подхватит мемо FBY.
