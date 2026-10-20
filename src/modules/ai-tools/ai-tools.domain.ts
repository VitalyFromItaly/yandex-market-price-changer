/**
 * Инструменты ИИ (TASK-147): схемы для модели, разбор аргументов и сборка
 * ответов. Чистые функции — без Nest и базы; данные приносит AiToolsService.
 *
 * ИИ не считает (решение `ai_explains_not_computes`): каждое число здесь —
 * поле, уже посчитанное движком P&L или журналом, плюс ссылка на операции,
 * из которых оно сложилось. Нет данных — `insufficientData` с причиной, а не ноль:
 * ноль модель честно перескажет продавцу как «убыточный месяц».
 */

import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { IFinanceAnomalyRow } from '../../database/postgres/repositories/finance-anomaly.repository';
import type { TFinanceExpenseCategoryRow } from '../../database/postgres/repositories/finance-expense.repository';
import type { YandexMarketDocument } from '../../database/schemas/yandex-market.schema';
import type { IProductSearchItem } from '../../database/services/product.service';
import type { TMarketplace } from '../../shared/marketplace';
import type { IAiSourceRefs, IAiToolResult } from '../ai/ai-tools.types';
import type { IPolzaTool } from '../ai/polza.client';
import type { IExpenseAllocation } from '../finance/expense-allocation';
import type { ICashflowReport } from '../finance/finance-cashflow.service';
import type { IFinancePeriod } from '../finance/finance-period';
import type { IFinanceScreenMonth, IFinanceScreenOperation } from '../finance/finance-screen';
import type { ITaxYearReport } from '../finance/finance-tax-year.service';
import type { IPnlCompareReport, IPnlMonthStatus, IPnlReport } from '../finance/finance.service';
import type { IForecast, IForecastMetrics, TForecastResult } from '../finance/forecast';
import type { IPnl } from '../finance/pnl';
import type { IPnlBrand } from '../finance/pnl-brand';
import type { IPnlSku } from '../finance/pnl-sku';
import type { IPriceCalcSkuRates } from '../finance/price-calc-rates';
import type { TFeatureKey } from '../telegram/bots/shared/features.domain';
import type { TFbyStockError } from '../yandex/fby/fby-message';
import type { IBrandSource, TBrandKey } from '../yandex/reports/brands';
import type { IReportResult } from '../yandex/reports/order-reports.service';
import type { TPeriodKey } from '../yandex/reports/report-period';
import type { IStockLevels } from '../yandex/stocks/stock-levels.service';

import { FINANCE_MARKETPLACES } from '../../database/postgres/finance.schema';
import { isMarketplace, MARKETPLACE_LABEL, MARKETPLACES } from '../../shared/marketplace';
import { PRICE_CALC_FAILURE_TEXT, priceFor, profitAt } from '../../shared/price-calc';
import { labelResolver } from '../finance/expense.domain';
import { ANOMALY_KIND_LABEL } from '../finance/finance-anomalies';
import { FINANCE_ARTICLE_KEYS, FINANCE_ARTICLE_META } from '../finance/finance-articles';
import { financeToday, MAX_RANGE_DAYS, parseDayRange } from '../finance/finance-period';
import { parseScreenMonth } from '../finance/finance-screen';
import {
  DEFAULT_FORECAST_BASIS_DAYS,
  FORECAST_BASIS_DAYS,
  isForecastBasisDays,
} from '../finance/forecast';
import {
  COMPARE_OPEX_NOTE,
  COMPARE_OPEX_UNSHARED_NOTE,
  COMPARE_TAX_NOTE,
  COMPARE_UNVERIFIED_NOTE,
} from '../finance/marketplace-compare';
import { brandEconomicsOf } from '../finance/pnl-brand';
import { SKU_COLUMNS } from '../finance/pnl-sku';
import { PRICE_CALC_WINDOW_DAYS } from '../finance/price-calc-rates';
import { OTHER_BRAND_TITLE } from '../finance/sales-analytics';
import {
  TAX_YEAR_HISTORY,
  TAX_YEAR_PERIOD_LABELS,
  isTaxYearInRange,
} from '../finance/tax-year.domain';
import { TAX_REGIME_LABELS } from '../finance/tax.domain';
import { marketplaceFeatures } from '../marketplaces/marketplace-connections.domain';
import { FEATURE } from '../telegram/bots/shared/features.domain';
import { fbyStockUnavailableLine } from '../yandex/fby/fby-message';
import { BRAND_KEYS, brandOf, brandTitle, isBrandKey } from '../yandex/reports/brands';
import { DEFAULT_PERIOD, PERIOD, periodTitle } from '../yandex/reports/report-period';
import { isFby } from '../yandex/stocks/placement';
import { LOW_STOCK_THRESHOLD } from '../yandex/stocks/stock-levels';
import { scopeStore } from '../yandex/stores/stores.domain';

export const AI_TOOL = {
  PNL: 'getPnl',
  SKU: 'getSkuEconomics',
  SEARCH: 'searchProducts',
  TOP: 'getTopSkus',
  BRAND: 'getBrandEconomics',
  COMPARE: 'compareMarketplaces',
  ANOMALIES: 'listAnomalies',
  OPERATIONS: 'getOperations',
  FORECAST: 'getForecast',
  CASHFLOW: 'getCashflow',
  TAX_YEAR: 'getTaxYear',
  PRICE: 'getPriceFor',
  EXPENSES: 'getExpenses',
  STOCKS: 'getStocks',
  RETURNS: 'getReturns',
} as const;

export type TAiToolName = (typeof AI_TOOL)[keyof typeof AI_TOOL];

/** Инструменты, у которых есть свой экран со своей фичей. */
export type TGatedAiTool =
  | typeof AI_TOOL.FORECAST
  | typeof AI_TOOL.CASHFLOW
  | typeof AI_TOOL.TAX_YEAR
  | typeof AI_TOOL.PRICE
  | typeof AI_TOOL.EXPENSES
  | typeof AI_TOOL.STOCKS
  | typeof AI_TOOL.RETURNS;

/**
 * Инструмент экрана виден модели только при открытой фиче этого экрана
 * (решения `forecast_ai_by_feature`, `ai_tools_by_screen_feature`): ИИ не
 * открывает продавцу то, что закрыто ему в навигации. `Record` — новый
 * инструмент экрана не соберётся без своей строки.
 */
export const AI_TOOL_FEATURE: Readonly<Record<TGatedAiTool, TFeatureKey>> = {
  [AI_TOOL.FORECAST]: FEATURE.FORECAST,
  // Своей фичи у ДДС нет — это вкладка «Финансов».
  [AI_TOOL.CASHFLOW]: FEATURE.FINANCE,
  [AI_TOOL.TAX_YEAR]: FEATURE.TAX_YEAR,
  [AI_TOOL.PRICE]: FEATURE.PRICE_CALCULATOR,
  [AI_TOOL.EXPENSES]: FEATURE.EXPENSES,
  // Живые данные Маркета (TASK-166): остатки — экран «Склад», возвраты — «Едет обратно».
  [AI_TOOL.STOCKS]: FEATURE.INVENTORY,
  [AI_TOOL.RETURNS]: FEATURE.REPORT_RETURNING,
};

/**
 * Фичи площадок (`ozon`, `wb`): `compareMarketplaces` виден всегда, но закрытая
 * площадка не читается — её строка приходит с причиной, как колонка `closed`
 * экрана «Сравнение площадок» (TASK-173).
 */
export const AI_MARKETPLACE_FEATURES: readonly TFeatureKey[] = [
  ...new Set(FINANCE_MARKETPLACES.flatMap(marketplaceFeatures)),
];

/** Фичи, от которых зависит набор инструментов, — их проверяет вызывающий. */
export const AI_GATED_FEATURES: readonly TFeatureKey[] = [
  ...new Set([...Object.values(AI_TOOL_FEATURE), ...AI_MARKETPLACE_FEATURES]),
];

/** Площадки с журналом, открытые при таких фичах; ЯМ — всегда (правило `isMarketplaceFeatureOpen`). */
export function openFinanceMarketplaces(features: ReadonlySet<TFeatureKey>): TFinanceMarketplace[] {
  return FINANCE_MARKETPLACES.filter((marketplace) =>
    marketplaceFeatures(marketplace).every((feature) => features.has(feature)),
  );
}

/** Скрытые инструменты при таком наборе открытых фич. */
export function hiddenAiTools(features: ReadonlySet<TFeatureKey>): Set<string> {
  return new Set(
    Object.entries(AI_TOOL_FEATURE)
      .filter(([, feature]) => !features.has(feature))
      .map(([tool]) => tool),
  );
}

/**
 * id операций в `sourceRefs` — первые N, полный счёт рядом. Статья месяца —
 * тысячи строк; все id в ответе съели бы контекст модели и деньги владельца.
 * Раскрытие дальше — `getOperations`.
 */
export const MAX_REF_IDS = 50;
/** id в одном `getOperations`: меньше потолка экрана (200) — каждая операция — десяток полей в контексте. */
export const MAX_TOOL_OPERATION_IDS = 50;
/** Аномалий в одном ответе. */
export const MAX_TOOL_ANOMALIES = 50;
/** Товаров бренда в одном ответе — остальные только в суммах бренда. */
export const MAX_BRAND_ITEMS = 10;
/** Товаров в ответе поиска и рейтинга: модели нужен выбор, а не каталог. */
export const MAX_SEARCH_RESULTS = 20;
export const MAX_TOP_SKUS = 20;
/** Умолчание `limit` поиска и рейтинга. */
export const DEFAULT_LIST_LIMIT = 10;
/** Короче — подстрока совпала бы с половиной каталога. */
export const MIN_SEARCH_QUERY = 2;
/** Строк остатков в одном ответе — от меньшего остатка; полный счёт — `total`. */
export const MAX_TOOL_STOCK_ROWS = 50;
/** Записей возвратов в одном ответе — числа в суммах всё равно по всем. */
export const MAX_TOOL_RETURN_RECORDS = 20;
/**
 * Периоды `getReturns` — кнопки «Едет обратно» без «Другого дня» (дата — второй
 * аргумент, и за вопросом «сколько едет обратно» её не бывает).
 */
export const RETURNS_PERIODS: readonly TPeriodKey[] = [
  PERIOD.TODAY,
  PERIOD.WEEK,
  PERIOD.MONTH,
  PERIOD.ALL,
];
/** id операций у одной аномалии. */
const ANOMALY_SAMPLE_IDS = 10;

/**
 * Площадки `getPnl`. Журналы Ozon и WB есть, но инструмент читает P&L по
 * умолчанию — ЯМ: открыть Ozon здесь значило бы отдать модели числа ЯМ под
 * именем Ozon. Площадки рядом — `compareMarketplaces` (`FinanceService.compare`).
 */
const FINANCE_READY: ReadonlySet<TMarketplace> = new Set<TMarketplace>(['ym']);

export const NO_FINANCE_FOR_MARKETPLACE = (marketplace: TMarketplace): string =>
  `По площадке ${MARKETPLACE_LABEL[marketplace]} финансового журнала нет — данных для ответа недостаточно`;
export const MARKETPLACE_CLOSED_TEXT = (marketplace: TMarketplace): string =>
  `Площадка ${MARKETPLACE_LABEL[marketplace]} продавцу закрыта — её финансы не читались, данных для ответа нет`;
export const NO_JOURNAL_TEXT =
  'Журнал операций за этот период не загружен — данных для ответа недостаточно';
export const NO_OPERATIONS_TEXT = 'За период в журнале нет ни одной операции';
export const NO_SKU_TEXT = (sku: string): string =>
  `У товара «${sku}» нет операций за период — данных о его экономике нет`;
export const NO_BRAND_TEXT = (title: string): string =>
  `У бренда «${title}» нет продаж за период — данных о его экономике нет`;
/** Значение `brand` для товаров вне реестра брендов. */
export const OTHER_BRAND_ARG = 'other';
export const BRAND_INVALID_TEXT = `brand: одно из ${[...BRAND_KEYS, OTHER_BRAND_ARG].join(', ')}`;
export const SEARCH_QUERY_INVALID_TEXT = `query: название, модель или артикул, от ${MIN_SEARCH_QUERY} символов`;
export const LIMIT_INVALID_TEXT = (max: number): string => `limit: целое от 1 до ${max}`;
export const NO_PRODUCTS_TEXT = (query: string): string =>
  `Товаров по запросу «${query}» не найдено — попробуйте часть названия или модель`;
export const TOP_BY_INVALID_TEXT = 'by: одно из net, revenue, units, margin';
export const TOP_ORDER_INVALID_TEXT = 'order: desc или asc';
export const NO_COST_NOTE = 'Без подтверждённого закупа — вне рейтинга: их чистая и маржа завышены';
export const NO_TOP_TEXT = (lossOnly: boolean, excluded: number): string =>
  (lossOnly
    ? 'Убыточных товаров с подтверждённым закупом за период нет'
    : 'За период нет товаров для такого рейтинга') +
  (excluded ? `; без закупа и вне рейтинга — ${excluded}` : '');
export const ANOMALIES_NOT_CHECKED_TEXT =
  'Месяц ещё не проверялся на аномалии — пустой список не значил бы «всё чисто»';
export const OPERATIONS_NOT_FOUND_TEXT = 'Операции с такими id не найдены';
export const TOOL_FAILED_TEXT = 'Не удалось получить данные — попробуйте позже';

// ── Схемы ──────────────────────────────────────────────────────────────────

/**
 * Магазин живых инструментов — НАЗВАНИЕМ, не номером кампании: номер продавцу
 * не показывается, а модель повторяет аргументы в ответе (решение
 * `ai_live_tools_store_by_name`). Названия — в поле `stores` ответа.
 */
const STORE_PROPS = {
  store: {
    type: 'string',
    description: 'Название магазина из поля stores ответа; не передано — активный магазин',
  },
} as const;

const PERIOD_PROPS = {
  from: { type: 'string', description: 'Начало периода, ГГГГ-ММ-ДД (по Москве)' },
  to: {
    type: 'string',
    description: `Конец периода включительно, ГГГГ-ММ-ДД; не длиннее ${MAX_RANGE_DAYS} дней`,
  },
} as const;

const objectSchema = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

const fn = (
  name: TAiToolName,
  description: string,
  parameters: Record<string, unknown>,
): IPolzaTool => ({
  type: 'function',
  function: { name, description, parameters },
});

/**
 * Описания для модели. Продавца в аргументах нет нигде: он зашит в набор
 * инструментов, и попросить чужие данные модели нечем.
 */
export const AI_TOOL_DEFINITIONS: IPolzaTool[] = [
  fn(
    AI_TOOL.PNL,
    'P&L продавца за период из журнала операций площадки: выручка, себестоимость, расходы ' +
      'площадки, налог, уровни прибыли, рентабельность, статьи. Суммы — копейки и рубли.',
    objectSchema(
      {
        ...PERIOD_PROPS,
        marketplace: {
          type: 'string',
          enum: MARKETPLACES,
          description: 'Площадка; по умолчанию ym (Яндекс Маркет)',
        },
      },
      ['from', 'to'],
    ),
  ),
  fn(
    AI_TOOL.SKU,
    'Экономика одного товара (артикул площадки) за период: продажи, комиссия, логистика, ' +
      'продвижение, себестоимость, налог, чистая прибыль, штуки и заказы.',
    objectSchema(
      { sku: { type: 'string', description: 'Артикул товара (offerId)' }, ...PERIOD_PROPS },
      ['sku', 'from', 'to'],
    ),
  ),
  fn(
    AI_TOOL.SEARCH,
    'Поиск товаров продавца по названию, модели или артикулу (например «F-91W», «Амфибия»). ' +
      'Отдаёт артикулы Яндекс Маркета (sku) — их передавай в getSkuEconomics. Слова запроса ' +
      'должны найтись все, регистр не важен.',
    objectSchema(
      {
        query: { type: 'string', description: 'Название, модель или артикул целиком или частью' },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_SEARCH_RESULTS,
          description: `Сколько товаров вернуть; по умолчанию ${DEFAULT_LIST_LIMIT}`,
        },
      },
      ['query'],
    ),
  ),
  fn(
    AI_TOOL.TOP,
    'Рейтинг товаров за период (Яндекс Маркет): лучшие или худшие по чистой прибыли, выручке, ' +
      'штукам или марже. lossOnly — только убыточные. Товары без подтверждённого закупа в ' +
      'рейтинг по чистой и марже не входят — их число в excludedNoCost.',
    objectSchema(
      {
        ...PERIOD_PROPS,
        by: {
          type: 'string',
          enum: ['net', 'revenue', 'units', 'margin'],
          description: 'net — чистая прибыль, revenue — выручка, units — штуки, margin — маржа',
        },
        order: {
          type: 'string',
          enum: ['desc', 'asc'],
          description: 'desc — сначала большие; по умолчанию desc, а при lossOnly — asc',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_TOP_SKUS,
          description: `Сколько товаров; по умолчанию ${DEFAULT_LIST_LIMIT}`,
        },
        lossOnly: { type: 'boolean', description: 'Только убыточные (чистая меньше нуля)' },
      },
      ['from', 'to', 'by'],
    ),
  ),
  fn(
    AI_TOOL.BRAND,
    'Экономика по брендам за период (Яндекс Маркет): продажи, комиссия, логистика, продвижение, ' +
      'себестоимость, налог, чистая прибыль, штуки и лучшие товары бренда. Без brand — все бренды ' +
      'списком. Бренды: ' +
      BRAND_KEYS.map((key) => `${key} — ${brandTitle(key)}`).join(', ') +
      `, ${OTHER_BRAND_ARG} — товары вне списка брендов.`,
    objectSchema(
      {
        brand: {
          type: 'string',
          enum: [...BRAND_KEYS, OTHER_BRAND_ARG],
          description: 'Бренд; не передан — все бренды',
        },
        ...PERIOD_PROPS,
      },
      ['from', 'to'],
    ),
  ),
  fn(
    AI_TOOL.COMPARE,
    'Сравнение площадок (Яндекс Маркет, Ozon, Wildberries) за период по уровням прибыли — те же ' +
      'числа, что экран «Сравнение площадок». Правила учёта (налог по начислению, расходы по доле ' +
      'выручки) — в rules, их надо оговорить. Площадка без данных приходит с insufficientData — ' +
      'нулём её считать нельзя.',
    objectSchema({ ...PERIOD_PROPS }, ['from', 'to']),
  ),
  fn(
    AI_TOOL.ANOMALIES,
    'Аномалии финансового журнала за календарный месяц: скачки комиссии, двойные начисления, ' +
      'штрафы, нераспознанные строки, товары без закупа.',
    objectSchema(
      {
        month: { type: 'string', description: 'Месяц ГГГГ-ММ' },
        unreviewedOnly: { type: 'boolean', description: 'Только непросмотренные продавцом' },
      },
      ['month'],
    ),
  ),
  fn(
    AI_TOOL.OPERATIONS,
    `Операции журнала по id (из sourceRefs других инструментов), не больше ${MAX_TOOL_OPERATION_IDS}.`,
    objectSchema(
      {
        ids: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: MAX_TOOL_OPERATION_IDS,
          description: 'id операций',
        },
      },
      ['ids'],
    ),
  ),
  fn(
    AI_TOOL.FORECAST,
    'Прогноз продавца — детерминированный, линейный (не факт): выручка, чистая, налог, возвраты и ' +
      'поступления до конца текущего месяца, продажи до конца года, рентабельность по месяцам. ' +
      'Метод — в поле method.text, его стоит назвать. Суммы — копейки и рубли.',
    objectSchema(
      {
        basisDays: {
          type: 'integer',
          enum: [...FORECAST_BASIS_DAYS],
          description: `Окно базы: средний день за столько последних дней; по умолчанию ${DEFAULT_FORECAST_BASIS_DAYS}`,
        },
      },
      [],
    ),
  ),
  fn(
    AI_TOOL.CASHFLOW,
    'Деньги месяца (Яндекс Маркет): выплаты Маркета по платёжным поручениям (mismatch — сумма ' +
      'поручения не сходится со строками журнала), выплаты по статьям, расходы, закупки и налоги, ' +
      'ДДС, а также «к получению» — сколько Маркет ещё должен на сегодня (receivable.asOf), по статьям.',
    objectSchema({ month: { type: 'string', description: 'Месяц ГГГГ-ММ' } }, ['month']),
  ),
  fn(
    AI_TOOL.TAX_YEAR,
    'Налоговый год ИП: доход с 1 января, по отчётным периодам (I квартал, полугодие, 9 месяцев, ' +
      'год — нарастающим итогом) налог, к уплате и авансовый платёж периода (advance), уплачено и ' +
      'остаток, лимит УСН и порог НДС, предупреждения и ПРОГНОЗ дохода на год (kind: прогноз).',
    objectSchema(
      {
        year: {
          type: 'integer',
          description: `Год; по умолчанию текущий; не раньше чем ${TAX_YEAR_HISTORY} года назад`,
        },
      },
      [],
    ),
  ),
  fn(
    AI_TOOL.PRICE,
    'Цена товара для нужной прибыли со штуки в рублях или рентабельности в % (как «Калькулятор ' +
      `цен»): ставки — факт товара за ${PRICE_CALC_WINDOW_DAYS} дней (или средние по всем ` +
      'товарам), закуп — из прайса, налог — из настроек. Отдаёт цену и разложение штуки. Это ' +
      'расчёт по ставкам, а не тариф Маркета. Нужна ровно одна цель.',
    objectSchema(
      {
        sku: { type: 'string', description: 'Артикул товара (offerId)' },
        targetProfitRub: { type: 'number', description: 'Прибыль со штуки, ₽' },
        targetMarginPercent: {
          type: 'number',
          description: 'Рентабельность — прибыль к продаже, %; меньше 100',
        },
        discountPercent: {
          type: 'number',
          minimum: 0,
          maximum: 100,
          description: 'Скидка от цены, %; по умолчанию 0',
        },
      },
      ['sku'],
    ),
  ),
  fn(
    AI_TOOL.EXPENSES,
    'Операционные расходы бизнеса за период по категориям (аренда, зарплаты, упаковка и свои ' +
      'категории продавца) — те, что вычитает P&L. Ежемесячные расходы делятся по дням месяца.',
    objectSchema({ ...PERIOD_PROPS }, ['from', 'to']),
  ),
  fn(
    AI_TOOL.STOCKS,
    'Остатки товаров на Яндекс Маркете СЕЙЧАС (живой запрос к Маркету, может идти до минуты): доступный ' +
      'к продаже остаток по артикулу — тот же, что в разделе «Склад». У магазина одна модель: FBS (свой ' +
      `склад) или FBY (склад Маркета), поле model. low — «на исходе», не больше ${LOW_STOCK_THRESHOLD} шт. ` +
      `Строк не больше ${MAX_TOOL_STOCK_ROWS}, от меньшего остатка; total — сколько подошло всего.`,
    objectSchema(
      {
        brand: {
          type: 'string',
          enum: [...BRAND_KEYS, OTHER_BRAND_ARG],
          description: 'Только товары бренда',
        },
        query: {
          type: 'string',
          description: `Часть названия или артикула, от ${MIN_SEARCH_QUERY} символов`,
        },
        onlyLow: {
          type: 'boolean',
          description: `Только «на исходе» (не больше ${LOW_STOCK_THRESHOLD} шт.)`,
        },
        ...STORE_PROPS,
      },
      [],
    ),
  ),
  fn(
    AI_TOOL.RETURNS,
    'Возвраты и невыкупы на Яндекс Маркете (живой запрос к Маркету) — те же числа, что отчёт ' +
      '«Едет обратно»: заказов, продажи, возвратов — сколько ещё едет к продавцу (inFlight) и сколько уже ' +
      `выдано магазину (settled). Периоды: ${RETURNS_PERIODS.join(', ')}; all — все активные возвраты.`,
    objectSchema(
      {
        period: {
          type: 'string',
          enum: [...RETURNS_PERIODS],
          description: `Период; по умолчанию ${DEFAULT_PERIOD.key}`,
        },
        ...STORE_PROPS,
      },
      [],
    ),
  ),
];

// ── Аргументы ──────────────────────────────────────────────────────────────

export type TArgs = Record<string, unknown>;

export const toolError = (error: string): IAiToolResult => ({ ok: false, error });
export const insufficient = (reason: string): IAiToolResult => ({
  ok: false,
  insufficientData: true,
  reason,
});

/**
 * Аргументы модели — сырой строкой. Объект и только известные поля:
 * `additionalProperties: false` в схеме — просьба, не гарантия, и лишнее поле
 * (`telegramUserId`) должно отказывать, а не молча игнорироваться.
 */
export function parseToolArgs(raw: string, allowed: readonly string[]): TArgs | string {
  let parsed: unknown;
  try {
    parsed = raw?.trim() ? JSON.parse(raw) : {};
  } catch {
    return 'Аргументы не JSON';
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return 'Аргументы — не объект';
  const extra = Object.keys(parsed).filter((key) => !allowed.includes(key));
  if (extra.length) return `Неизвестные аргументы: ${extra.join(', ')}`;
  return parsed as TArgs;
}

export function allowedArgs(name: TAiToolName): string[] {
  const tool = AI_TOOL_DEFINITIONS.find((t) => t.function.name === name);
  return Object.keys((tool?.function.parameters.properties ?? {}) as object);
}

export const PERIOD_INVALID_TEXT = `Период: нужны from и to ГГГГ-ММ-ДД, не задом наперёд, не длиннее ${MAX_RANGE_DAYS} дней`;

export function periodArg(args: TArgs): IFinancePeriod | null {
  return parseDayRange(args.from, args.to);
}

export function marketplaceArg(args: TArgs): TMarketplace | null {
  if (args.marketplace === undefined) return 'ym';
  return isMarketplace(args.marketplace) ? args.marketplace : null;
}

export function monthArg(args: TArgs): IFinanceScreenMonth | null {
  return parseScreenMonth(args.month);
}

export function hasFinance(marketplace: TMarketplace): boolean {
  return FINANCE_READY.has(marketplace);
}

// ── Ответы ─────────────────────────────────────────────────────────────────

export interface IAiMoney {
  kopecks: number;
  /** Рубли с копейками строкой: модель пересказывает число, а не делит на 100 сама. */
  rub: string;
}

export const money = (kopecks: number): IAiMoney => ({
  kopecks,
  rub: (kopecks / 100).toFixed(2),
});

/** Доля → проценты с двумя знаками; null — знаменателя нет, «0 %» было бы неправдой. */
const percent = (ratio: number | null): number | null =>
  ratio === null ? null : Math.round(ratio * 10_000) / 100;

/** Ссылки: уникальные id в порядке появления, первые MAX_REF_IDS, полный счёт отдельно. */
export function sourceRefs(
  source: string,
  period: IFinancePeriod | undefined,
  idLists: readonly (readonly string[])[],
  documentIds?: readonly (string | null)[],
): IAiSourceRefs {
  const ids = [...new Set(idLists.flat())];
  const docs = documentIds
    ? [...new Set(documentIds.filter((id): id is string => Boolean(id)))]
    : [];
  return {
    source,
    ...(period ? { period: { from: period.from, to: period.to } } : {}),
    operationIds: ids.slice(0, MAX_REF_IDS),
    operationCount: ids.length,
    ...(docs.length ? { documentIds: docs } : {}),
  };
}

function pnlIdLists(pnl: IPnl): string[][] {
  return [
    ...FINANCE_ARTICLE_KEYS.map((key) => pnl.byArticle[key].operationIds),
    pnl.reference.operationIds,
  ];
}

/**
 * Данных нет: журнал ни за один месяц периода не загружен — или загружен, но
 * пуст. Первое — «не знаем», второе — тоже не повод печатать нули.
 */
export function pnlInsufficiency(report: IPnlReport): string | null {
  if (report.months.every((month) => month.status === null)) return NO_JOURNAL_TEXT;
  if (pnlIdLists(report.pnl).every((ids) => !ids.length)) return NO_OPERATIONS_TEXT;
  return null;
}

function pnlLevels(pnl: IPnl) {
  return {
    revenue: money(pnl.revenueKopecks),
    otherIncome: money(pnl.otherIncomeKopecks),
    cogs: money(pnl.cogs.kopecks),
    gross: money(pnl.grossKopecks),
    marketplaceExpenses: money(pnl.marketplaceKopecks),
    unrecognized: money(pnl.unrecognizedKopecks),
    afterMarketplace: money(pnl.afterMarketplaceKopecks),
    operatingExpenses: money(pnl.operatingExpenses.totalKopecks),
    operating: money(pnl.operatingKopecks),
    tax: money(pnl.tax.taxKopecks),
    net: money(pnl.netKopecks),
    grossMarginPercent: percent(pnl.grossMargin),
    netMarginPercent: percent(pnl.netMargin),
    ordersCount: pnl.ordersCount,
    units: pnl.units,
  };
}

/** Метки достоверности: непроверенный месяц и неполный закуп модель обязана оговорить. */
function pnlQuality(report: IPnlReport) {
  return {
    status: report.status,
    statusLabel: report.statusLabel,
    /** false — у части проданного нет закупа: себестоимость занижена, прибыль завышена. */
    costComplete: report.pnl.unconfirmed.confirmed,
    /** Прибыль не подтверждена: столько заказов и на такую сумму продано без закупа на дату. */
    ordersWithoutCost: report.pnl.unconfirmed.orders,
    revenueWithoutCost: money(report.pnl.unconfirmed.revenueKopecks),
    skusWithoutCost: report.pnl.unconfirmed.skus.length,
    taxIsDefault: report.taxIsDefault,
  };
}

export function pnlResult(report: IPnlReport): IAiToolResult {
  const reason = pnlInsufficiency(report);
  if (reason) return insufficient(reason);
  const { pnl } = report;
  const articles = FINANCE_ARTICLE_KEYS.filter((key) => pnl.byArticle[key].operationIds.length).map(
    (key) => ({
      article: key,
      title: FINANCE_ARTICLE_META[key].title,
      amount: money(pnl.byArticle[key].kopecks),
      operationCount: pnl.byArticle[key].operationIds.length,
    }),
  );
  return {
    ok: true,
    data: {
      marketplace: 'ym',
      period: pnl.period,
      ...pnlQuality(report),
      levels: pnlLevels(pnl),
      articles,
    },
    sourceRefs: sourceRefs('finance:pnl', pnl.period, pnlIdLists(pnl)),
  };
}

export function skuResult(report: IPnlReport, sku: string, name: string | null): IAiToolResult {
  const missing = pnlInsufficiency(report);
  if (missing) return insufficient(missing);
  const row: IPnlSku | undefined = report.pnl.skus.skus.find((s) => s.sku === sku);
  if (!row) return insufficient(NO_SKU_TEXT(sku));

  const ids = [
    ...report.pnl.cogs.bySku.filter((s) => s.sku === sku).map((s) => s.operationIds),
    ...report.pnl.cogs.unknown.filter((s) => s.sku === sku).map((s) => s.operationIds),
  ];
  const revenue = row.columns.revenue;
  return {
    ok: true,
    data: {
      sku,
      name,
      period: report.pnl.period,
      statusLabel: report.statusLabel,
      /** false — закупа на дату нет у части проданного: прибыль не подтверждена. */
      costKnown: row.costKnown,
      units: row.units,
      orders: row.orders,
      schemes: row.schemes.map((s) => s.scheme).filter(Boolean),
      columns: Object.fromEntries(SKU_COLUMNS.map((c) => [c, money(row.columns[c])])),
      cogs: money(row.cogsKopecks),
      tax: money(row.taxKopecks),
      net: money(row.netKopecks),
      netMarginPercent: revenue > 0 ? percent(row.netKopecks / revenue) : null,
      netPerUnit: row.units > 0 ? money(Math.round(row.netKopecks / row.units)) : null,
    },
    // Строки продаж и возвратов товара — те, по которым считана его себестоимость.
    sourceRefs: sourceRefs('finance:sku', report.pnl.period, ids),
  };
}

/** Бренд из аргументов: не передан — undefined (все), `other` — null, мусор — false. */
export function brandArg(args: TArgs): TBrandKey | null | undefined | false {
  if (args.brand === undefined) return undefined;
  if (args.brand === OTHER_BRAND_ARG) return null;
  return isBrandKey(args.brand) ? args.brand : false;
}

// ── Поиск товаров и рейтинг (TASK-164) ─────────────────────────────────────

/** `limit`: не передан — умолчание, мусор — null. */
export function limitArg(args: TArgs, max: number): number | null {
  if (args.limit === undefined) return Math.min(DEFAULT_LIST_LIMIT, max);
  const limit = args.limit;
  return typeof limit === 'number' && Number.isInteger(limit) && limit >= 1 && limit <= max
    ? limit
    : null;
}

export function searchQueryArg(args: TArgs): string | null {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  return query.length >= MIN_SEARCH_QUERY ? query : null;
}

/**
 * Найденные товары. Финансовый журнал — по ЯМ, поэтому `sku` — артикул ЯМ;
 * товар без карточки ЯМ приходит с `sku: null`: экономики по нему спросить нечем.
 * Ссылок на операции нет — это справочник, а не деньги; `sourcesOf` пустую ссылку
 * не показывает.
 */
export function searchResult(
  query: string,
  found: { items: IProductSearchItem[]; total: number },
): IAiToolResult {
  if (!found.items.length) return insufficient(NO_PRODUCTS_TEXT(query));
  return {
    ok: true,
    data: {
      query,
      total: found.total,
      shown: found.items.length,
      products: found.items.map((item) => ({
        sku: item.marketplaceSkus?.ym ?? null,
        name: item.name ?? null,
        internalSku: item.internalSku,
        vendorCode: item.vendorCode ?? null,
      })),
      note: 'sku — артикул Яндекс Маркета для getSkuEconomics; sku: null — товара на Маркете нет',
    },
    sourceRefs: sourceRefs('products:search', undefined, []),
  };
}

export type TTopSkusBy = 'net' | 'revenue' | 'units' | 'margin';
export type TTopSkusOrder = 'desc' | 'asc';

export interface ITopSkusArgs {
  period: IFinancePeriod;
  by: TTopSkusBy;
  order: TTopSkusOrder;
  limit: number;
  lossOnly: boolean;
}

const TOP_BY: Record<TTopSkusBy, true> = { net: true, revenue: true, units: true, margin: true };

/** Аргументы рейтинга или текст ошибки для модели. */
export function topSkusArgs(args: TArgs): ITopSkusArgs | string {
  const period = periodArg(args);
  if (!period) return PERIOD_INVALID_TEXT;
  const by = args.by;
  if (typeof by !== 'string' || !Object.prototype.hasOwnProperty.call(TOP_BY, by)) {
    return TOP_BY_INVALID_TEXT;
  }
  if (args.lossOnly !== undefined && typeof args.lossOnly !== 'boolean') {
    return 'lossOnly — да или нет';
  }
  const lossOnly = args.lossOnly === true;
  if (args.order !== undefined && args.order !== 'desc' && args.order !== 'asc') {
    return TOP_ORDER_INVALID_TEXT;
  }
  const order: TTopSkusOrder = (args.order as TTopSkusOrder) ?? (lossOnly ? 'asc' : 'desc');
  const limit = limitArg(args, MAX_TOP_SKUS);
  if (limit === null) return LIMIT_INVALID_TEXT(MAX_TOP_SKUS);
  return { period, by: by as TTopSkusBy, order, limit, lossOnly };
}

/** Маржа товара: только при подтверждённом закупе и выручке — иначе её нет. */
const skuMargin = (row: IPnlSku): number | null =>
  row.costKnown && row.columns.revenue > 0 ? row.netKopecks / row.columns.revenue : null;

const topValue = (row: IPnlSku, by: TTopSkusBy): number => {
  if (by === 'revenue') return row.columns.revenue;
  if (by === 'units') return row.units;
  if (by === 'margin') return skuMargin(row) ?? 0;
  return row.netKopecks;
};

export interface ITopSkusPick {
  rows: IPnlSku[];
  /** Товаров с движением в периоде. */
  totalSkus: number;
  /** Выпали из рейтинга прибыли и маржи без подтверждённого закупа (правило `sku-ratings`). */
  excludedNoCost: number;
}

/**
 * Отбор рейтинга из строк разреза `pnl.skus` — тех же, что `getSkuEconomics`.
 * Чистая и маржа товара без закупа завышены, поэтому в рейтинг по ним (и в
 * «убыточные») он не попадает: место в «самых прибыльных» было бы выдумкой.
 * Выручка и штуки от закупа не зависят — там он остаётся.
 */
export function pickTopSkus(pnl: IPnl, args: ITopSkusArgs): ITopSkusPick {
  const skus = pnl.skus.skus;
  const needsCost = args.lossOnly || args.by === 'net' || args.by === 'margin';
  const excludedNoCost = needsCost ? skus.filter((row) => !row.costKnown).length : 0;
  const eligible = skus.filter((row) => {
    if (needsCost && !row.costKnown) return false;
    if (args.lossOnly) return row.netKopecks < 0;
    if (args.by === 'revenue') return row.columns.revenue > 0;
    if (args.by === 'units') return row.units > 0;
    if (args.by === 'margin') return skuMargin(row) !== null;
    return true;
  });
  const sign = args.order === 'desc' ? -1 : 1;
  const rows = eligible
    .sort(
      (a, b) => sign * (topValue(a, args.by) - topValue(b, args.by)) || a.sku.localeCompare(b.sku),
    )
    .slice(0, args.limit);
  return { rows, totalSkus: skus.length, excludedNoCost };
}

export function topSkusResult(
  report: IPnlReport,
  args: ITopSkusArgs,
  pick: ITopSkusPick,
  names: ReadonlyMap<string, string>,
): IAiToolResult {
  const missing = pnlInsufficiency(report);
  if (missing) return insufficient(missing);
  if (!pick.rows.length) return insufficient(NO_TOP_TEXT(args.lossOnly, pick.excludedNoCost));
  const { pnl } = report;
  return {
    ok: true,
    data: {
      period: pnl.period,
      statusLabel: report.statusLabel,
      by: args.by,
      order: args.order,
      lossOnly: args.lossOnly,
      totalSkus: pick.totalSkus,
      ...(pick.excludedNoCost
        ? { excludedNoCost: { count: pick.excludedNoCost, note: NO_COST_NOTE } }
        : {}),
      items: pick.rows.map((row) => ({
        sku: row.sku,
        name: names.get(row.sku) ?? null,
        costKnown: row.costKnown,
        units: row.units,
        orders: row.orders,
        revenue: money(row.columns.revenue),
        cogs: money(row.cogsKopecks),
        net: money(row.netKopecks),
        netMarginPercent: percent(skuMargin(row)),
        netPerUnit: row.units > 0 ? money(Math.round(row.netKopecks / row.units)) : null,
      })),
    },
    sourceRefs: sourceRefs(
      'finance:top-skus',
      pnl.period,
      skuIdLists(pnl, new Set(pick.rows.map((row) => row.sku))),
    ),
  };
}

function brandData(brand: IPnlBrand) {
  const revenue = brand.columns.revenue;
  return {
    brand: brand.key ?? OTHER_BRAND_ARG,
    title: brand.title,
    /** false — у части товаров бренда нет закупа на дату: прибыль не подтверждена. */
    costKnown: brand.costKnown,
    skus: brand.skus,
    units: brand.units,
    /** Сумма заказов по товарам: заказ с двумя товарами бренда посчитан дважды. */
    ordersSumBySku: brand.orders,
    columns: Object.fromEntries(SKU_COLUMNS.map((c) => [c, money(brand.columns[c])])),
    cogs: money(brand.cogsKopecks),
    tax: money(brand.taxKopecks),
    net: money(brand.netKopecks),
    netMarginPercent: revenue > 0 ? percent(brand.netKopecks / revenue) : null,
  };
}

/** Строки продаж и возвратов товаров — те, по которым считана их себестоимость. */
function skuIdLists(pnl: IPnl, skus: ReadonlySet<string>): string[][] {
  return [...pnl.cogs.bySku, ...pnl.cogs.unknown]
    .filter((entry) => skus.has(entry.sku))
    .map((entry) => entry.operationIds);
}

/**
 * Экономика по брендам — свёртка тех же строк разреза, что `getSkuEconomics`
 * (`brandEconomicsOf`). `brand` не передан — все бренды без товаров внутри:
 * список отвечает на «какой бренд выгоднее», а товары — на вопрос про один бренд.
 */
export function brandResult(
  report: IPnlReport,
  products: ReadonlyMap<string, IBrandSource>,
  brand: TBrandKey | null | undefined,
): IAiToolResult {
  const missing = pnlInsufficiency(report);
  if (missing) return insufficient(missing);
  const { pnl } = report;
  const brands = brandEconomicsOf(pnl.skus.skus, products);
  const common = { period: pnl.period, statusLabel: report.statusLabel };

  if (brand === undefined) {
    return {
      ok: true,
      data: {
        ...common,
        brands: brands.map(brandData),
        notByProduct: {
          note: 'Абонентская плата, хранение и операции без товара — к брендам не относятся',
          net: money(pnl.skus.rest.netKopecks),
        },
      },
      sourceRefs: sourceRefs(
        'finance:brand',
        pnl.period,
        skuIdLists(pnl, new Set(pnl.skus.skus.map((s) => s.sku))),
      ),
    };
  }

  const found = brands.find((b) => b.key === brand);
  if (!found) return insufficient(NO_BRAND_TEXT(brand ? brandTitle(brand) : OTHER_BRAND_TITLE));
  return {
    ok: true,
    data: {
      ...common,
      ...brandData(found),
      topItems: found.items.slice(0, MAX_BRAND_ITEMS).map((item) => ({
        sku: item.sku,
        name: item.name,
        units: item.units,
        revenue: money(item.revenueKopecks),
        net: money(item.netKopecks),
        costKnown: item.costKnown,
      })),
    },
    sourceRefs: {
      ...sourceRefs(
        'finance:brand',
        pnl.period,
        skuIdLists(pnl, new Set(found.items.map((item) => item.sku))),
      ),
      label: `Экономика бренда «${found.title}»`,
    },
  };
}

/**
 * Сравнение площадок (TASK-173) — ответ `FinanceService.compare`, той же двери,
 * что экран «Сравнение площадок»: налог по начислению у всех, операционные
 * расходы по доле выручки — правила едут строками в `rules`. Площадка без
 * отчёта (закрыта) или без журнала — своя причина, не нули; данных нет ни у
 * одной — сравнивать нечего.
 */
export function compareResult(
  order: readonly TFinanceMarketplace[],
  compare: IPnlCompareReport,
): IAiToolResult {
  const withData: IPnlReport[] = [];
  const reasons: string[] = [];
  const marketplaces = order.map((marketplace) => {
    const base = { marketplace, label: MARKETPLACE_LABEL[marketplace] };
    const report = compare.reports.find((entry) => entry.marketplace === marketplace)?.report;
    const missing = report ? pnlInsufficiency(report) : MARKETPLACE_CLOSED_TEXT(marketplace);
    if (missing) {
      reasons.push(`${MARKETPLACE_LABEL[marketplace]}: ${missing}`);
      return { ...base, insufficientData: true, reason: missing };
    }
    withData.push(report);
    return { ...base, ...pnlQuality(report), levels: pnlLevels(report.pnl) };
  });
  if (!withData.length) return insufficient(reasons.join('; '));

  const rules = [
    COMPARE_TAX_NOTE,
    compare.opexShared ? COMPARE_OPEX_NOTE : COMPARE_OPEX_UNSHARED_NOTE,
  ];
  if (withData.some((report) => report.status !== 'verified')) rules.push(COMPARE_UNVERIFIED_NOTE);
  const { period } = withData[0].pnl;
  return {
    ok: true,
    data: {
      period,
      rules,
      operatingExpenses: money(compare.operatingExpensesKopecks),
      taxIsDefault: compare.taxIsDefault,
      marketplaces,
    },
    sourceRefs: sourceRefs(
      'finance:compare',
      period,
      withData.flatMap((report) => pnlIdLists(report.pnl)),
    ),
  };
}

export interface IAnomaliesInput {
  month: IFinanceScreenMonth;
  items: IFinanceAnomalyRow[];
  total: number;
  unreviewed: number;
  checkedAt: Date | null;
}

export function anomaliesResult(input: IAnomaliesInput): IAiToolResult {
  if (!input.checkedAt) return insufficient(ANOMALIES_NOT_CHECKED_TEXT);
  const items = input.items.slice(0, MAX_TOOL_ANOMALIES);
  return {
    ok: true,
    data: {
      month: input.month.month,
      checkedAt: input.checkedAt.toISOString(),
      total: input.total,
      unreviewed: input.unreviewed,
      anomalies: items.map((a) => ({
        kind: a.kind,
        label: ANOMALY_KIND_LABEL[a.kind],
        amount: a.amountKopecks === null ? null : money(a.amountKopecks),
        sku: a.sku,
        orderId: a.orderId,
        detail: a.detail,
        threshold: a.threshold,
        reviewed: a.reviewed,
        operationCount: a.operationCount,
        operationIds: a.operationIds.slice(0, ANOMALY_SAMPLE_IDS),
      })),
    },
    sourceRefs: sourceRefs(
      'finance:anomalies',
      input.month.period,
      items.map((a) => a.operationIds),
    ),
  };
}

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

export function operationsResult(operations: IFinanceScreenOperation[]): IAiToolResult {
  if (!operations.length) return insufficient(OPERATIONS_NOT_FOUND_TEXT);
  return {
    ok: true,
    data: {
      operations: operations.map((op) => ({
        id: op.id,
        article: op.article,
        title: FINANCE_ARTICLE_META[op.article]?.title ?? op.article,
        amount: money(op.amountKopecks),
        orderId: op.orderId,
        sku: op.sku,
        serviceName: op.serviceName,
        transactionType: op.transactionType,
        transactionSource: op.transactionSource,
        count: op.count,
        accruedAt: iso(op.accruedAt),
        paidAt: iso(op.paidAt),
        actDate: iso(op.actDate),
        bankOrderId: op.bankOrderId,
        documentId: op.documentId,
      })),
    },
    sourceRefs: sourceRefs(
      'finance:operations',
      undefined,
      [operations.map((op) => op.id)],
      operations.map((op) => op.documentId),
    ),
  };
}

// ── Прогноз (TASK-151) ─────────────────────────────────────────────────────

export const FORECAST_BASIS_INVALID_TEXT = `basisDays: одно из ${FORECAST_BASIS_DAYS.join(', ')}`;

/** Окно базы; не передано — умолчание, мусор — null. */
export function basisDaysArg(args: TArgs): (typeof FORECAST_BASIS_DAYS)[number] | null {
  if (args.basisDays === undefined) return DEFAULT_FORECAST_BASIS_DAYS;
  return isForecastBasisDays(args.basisDays) ? args.basisDays : null;
}

function forecastMetrics(m: IForecastMetrics) {
  return {
    revenue: money(m.revenueKopecks),
    net: money(m.netKopecks),
    tax: money(m.taxKopecks),
    returns: money(m.returnsKopecks),
    payable: money(m.payableKopecks),
    units: m.units,
    orders: m.orders,
  };
}

function forecastData(f: IForecast) {
  return {
    /** Метка: всё ниже, кроме fact, — оценка, а не данные журнала. */
    kind: 'прогноз',
    today: f.today,
    method: { basisDays: f.method.basisDays, basis: f.method.basis, text: f.method.text },
    dailyAverage: forecastMetrics(f.daily),
    month: {
      period: f.month.period,
      factTo: f.month.factTo,
      remainingDays: f.month.remainingDays,
      fact: forecastMetrics(f.month.fact),
      forecast: forecastMetrics(f.month.forecast),
      netMarginPercent: percent(f.month.netMargin),
    },
    year: {
      year: f.year.year,
      remainingDays: f.year.remainingDays,
      fact: forecastMetrics(f.year.fact),
      forecast: forecastMetrics(f.year.forecast),
    },
    taxSharePercent: percent(f.taxShare),
    returnsSharePercent: percent(f.returnsShare),
    inflow: {
      asOf: f.inflow.asOf,
      receivable: money(f.inflow.receivableKopecks),
      accrualsToMonthEnd: money(f.inflow.accrualsKopecks),
      total: money(f.inflow.totalKopecks),
    },
    margins: f.margins.map((m) => ({
      month: m.month,
      kind: m.kind === 'forecast' ? 'прогноз' : 'факт',
      netMarginPercent: percent(m.netMargin),
    })),
    /** false — у части проданного в окне нет закупа: прогноз чистой завышен. */
    costComplete: f.unconfirmed.confirmed,
    taxIsDefault: f.taxIsDefault,
  };
}

/**
 * Прогноз для модели — те же числа, что на экране «Прогнозов» (одна дверь
 * `FinanceForecastService`), уже округлённые: модель их пересказывает, а не
 * считает. Источник — операции окна базы: из них прогноз и сложился.
 */
export function forecastResult(
  result: TForecastResult,
  basis: IFinancePeriod,
  basisOperationIds: readonly string[],
): IAiToolResult {
  // strictNullChecks выключен — union не сужается, поля читаются через cast.
  if (!result.ok) return insufficient((result as { reason: string }).reason);
  const forecast = (result as { forecast: IForecast }).forecast;
  return {
    ok: true,
    data: forecastData(forecast),
    sourceRefs: {
      ...sourceRefs('finance:forecast', basis, [basisOperationIds]),
      label: `Окно базы прогноза, ${forecast.method.basisDays} дн.`,
    },
  };
}

// ── Деньги, налоги, цена, расходы (TASK-165) ───────────────────────────────

/** Поручений в ответе: выплаты бывают ежедневными, модели нужен месяц, а не выписка. */
export const MAX_TOOL_PAYOUTS = 40;

export const TAX_YEAR_ARG_INVALID_TEXT = `year: текущий год или до ${TAX_YEAR_HISTORY} прошлых`;
export const NO_TAX_JOURNAL_TEXT =
  'Журнал операций за этот год не загружен — данных для ответа недостаточно';
export const NO_EXPENSES_TEXT = 'За период расходов бизнеса не внесено';
export const PRICE_TARGET_INVALID_TEXT =
  'Нужна ровно одна цель: targetProfitRub (₽ со штуки) или targetMarginPercent (%, меньше 100)';
export const PRICE_DISCOUNT_INVALID_TEXT = 'discountPercent: число от 0 до 100';
export const NO_PRICE_RATES_TEXT = (sku: string): string =>
  `Ставок для «${sku}» нет: за ${PRICE_CALC_WINDOW_DAYS} дней не было продаж ни у товара, ни у магазина`;
export const NO_PRICE_COGS_TEXT = (sku: string): string =>
  `Закупа «${sku}» нет ни в прайсе, ни в подтверждённом факте — цену не подобрать`;

/** «Журнал не загружен» — ни один месяц периода; частично загруженное — списком. */
export function notLoadedMonths(months: readonly IPnlMonthStatus[]): string[] {
  return months.filter((m) => m.status === null).map((m) => m.from.slice(0, 7));
}

const articleTitle = (article: string): string =>
  FINANCE_ARTICLE_META[article as keyof typeof FINANCE_ARTICLE_META]?.title ?? article;

function categoriesOf(
  byCategory: Record<string, number>,
  categories: readonly TFinanceExpenseCategoryRow[],
) {
  const labelOf = labelResolver(categories);
  return Object.entries(byCategory)
    .map(([key, kopecks]) => ({ key, label: labelOf(key), kopecks }))
    .sort((a, b) => b.kopecks - a.kopecks || a.label.localeCompare(b.label))
    .map((row) => ({ key: row.key, label: row.label, amount: money(row.kopecks) }));
}

/**
 * ДДС месяца — тот же `FinanceCashflowService.build`, что вкладка «Деньги»
 * «Финансов». «К получению» — на сегодня, а не на конец месяца (довод сервиса).
 */
export function cashflowResult(
  month: IFinanceScreenMonth,
  report: ICashflowReport,
  categories: readonly TFinanceExpenseCategoryRow[],
  months: readonly IPnlMonthStatus[],
): IAiToolResult {
  if (notLoadedMonths(months).length === months.length) return insufficient(NO_JOURNAL_TEXT);
  const { cashflow, receivable } = report;
  return {
    ok: true,
    data: {
      month: month.month,
      period: cashflow.period,
      inflow: {
        payouts: money(cashflow.inflow.payoutsKopecks),
        total: money(cashflow.inflow.totalKopecks),
      },
      outflow: {
        purchases: money(cashflow.outflow.purchasesKopecks),
        expenses: money(cashflow.outflow.expensesKopecks),
        expensesByCategory: categoriesOf(cashflow.outflow.expensesByCategory, categories),
        taxes: money(cashflow.outflow.taxesKopecks),
        total: money(cashflow.outflow.totalKopecks),
      },
      net: money(cashflow.netKopecks),
      payoutCount: cashflow.payouts.length,
      payouts: cashflow.payouts.slice(0, MAX_TOOL_PAYOUTS).map((p) => ({
        day: p.day,
        bankOrderId: p.bankOrderId,
        amount: money(p.kopecks),
        linesAmount: money(p.linesKopecks),
        operationCount: p.operationCount,
        /** true — сумма поручения не равна сумме строк журнала. */
        mismatch: p.mismatch,
      })),
      payoutArticles: cashflow.payoutArticles.map((a) => ({
        article: a.article,
        title: articleTitle(a.article),
        amount: money(a.kopecks),
        operationCount: a.operationIds.length,
      })),
      receivable: {
        asOf: receivable.asOf,
        note: 'На сегодня (asOf), а не на конец месяца: начислено, но Маркетом ещё не выплачено',
        total: money(receivable.totalKopecks),
        operationCount: receivable.operationCount,
        byArticle: receivable.byArticle.map((r) => ({
          article: r.article,
          title: articleTitle(r.article),
          amount: money(r.kopecks),
          operationCount: r.operationCount,
        })),
      },
    },
    sourceRefs: sourceRefs(
      'finance:cashflow',
      cashflow.period,
      cashflow.payoutArticles.map((a) => a.operationIds),
    ),
  };
}

/** Год; не передан — текущий по Москве, вне окна модуля — null. */
export function taxYearArg(args: TArgs, now: Date): number | null {
  const current = Number(financeToday(now).slice(0, 4));
  if (args.year === undefined) return current;
  return isTaxYearInRange(args.year, current) ? args.year : null;
}

/** Месяцы года, по которым смотрится журнал: с 1 января по сегодня (или по 31 декабря). */
export function taxYearSpan(year: number, now: Date): IFinancePeriod {
  const today = financeToday(now);
  const yearTo = `${year}-12-31`;
  return { from: `${year}-01-01`, to: today < yearTo ? today : yearTo };
}

/**
 * Налоговый год — тот же `FinanceTaxYearService.build`, что раздел «Налоги».
 * Прогноз помечен `kind: 'прогноз'`: модель обязана назвать его прогнозом.
 */
export function taxYearResult(
  report: ITaxYearReport,
  span: IFinancePeriod,
  months: readonly IPnlMonthStatus[],
): IAiToolResult {
  const missing = notLoadedMonths(months);
  if (missing.length === months.length) return insufficient(NO_TAX_JOURNAL_TEXT);
  const { taxYear, settings, params } = report;
  const limit = (kopecks: number | null | undefined) =>
    kopecks === null || kopecks === undefined ? null : money(kopecks);
  return {
    ok: true,
    data: {
      year: taxYear.year,
      closed: taxYear.closed,
      regime: TAX_REGIME_LABELS[settings.regime],
      ratePercent: settings.rateBasisPoints / 100,
      taxIsDefault: report.taxIsDefault,
      ...(missing.length ? { monthsNotLoaded: missing } : {}),
      incomeSinceYearStart: money(taxYear.incomeKopecks),
      periods: taxYear.periods.map((p) => ({
        period: p.key,
        label: TAX_YEAR_PERIOD_LABELS[p.key],
        from: p.from,
        to: p.to,
        closed: p.closed,
        /** Нарастающим итогом с 1 января. */
        income: money(p.incomeKopecks),
        tax: money(p.taxKopecks),
        reduction: money(p.reductionKopecks),
        due: money(p.dueKopecks),
        /** Платёж за сам период: к уплате минус прошлые периоды; < 0 — к зачёту. */
        advance: money(p.advanceKopecks),
        minimumApplied: p.minimumApplied,
      })),
      paid: money(taxYear.paidKopecks),
      balance: money(taxYear.balanceKopecks),
      limits: {
        usnIncomeLimit: limit(params?.usnIncomeLimitKopecks),
        vatThreshold: limit(params?.vatThresholdKopecks),
      },
      warnings: taxYear.warnings.map((w) => ({ level: w.level, text: w.text })),
      forecast: taxYear.forecast
        ? {
            kind: 'прогноз',
            income: money(taxYear.forecast.incomeKopecks),
            basisDays: taxYear.forecast.basisDays,
          }
        : null,
    },
    sourceRefs: sourceRefs('finance:tax-year', span, []),
  };
}

export interface IPriceForArgs {
  sku: string;
  target: { kind: 'profit'; kopecks: number } | { kind: 'margin'; rate: number };
  discountRate: number;
}

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Аргументы цены или текст ошибки для модели. */
export function priceForArgs(args: TArgs): IPriceForArgs | string {
  const sku = typeof args.sku === 'string' ? args.sku.trim() : '';
  if (!sku) return 'Не передан артикул';
  const profit = args.targetProfitRub;
  const margin = args.targetMarginPercent;
  if ((profit === undefined) === (margin === undefined)) return PRICE_TARGET_INVALID_TEXT;
  if (profit !== undefined && !isNumber(profit)) return PRICE_TARGET_INVALID_TEXT;
  if (margin !== undefined && !(isNumber(margin) && margin < 100)) return PRICE_TARGET_INVALID_TEXT;
  const discount = args.discountPercent ?? 0;
  if (!isNumber(discount) || discount < 0 || discount > 100) return PRICE_DISCOUNT_INVALID_TEXT;
  return {
    sku,
    target:
      profit !== undefined
        ? { kind: 'profit', kopecks: Math.round((profit as number) * 100) }
        : { kind: 'margin', rate: (margin as number) / 100 },
    discountRate: discount / 100,
  };
}

/**
 * Цена товара — та же формула `priceFor`/`profitAt` (`src/shared/price-calc.ts`)
 * над теми же ставками, что строка «Калькулятора цен» (`PriceCalcRatesService`).
 * Решения нет — причина словами экрана, а не ноль.
 */
export function priceForResult(args: IPriceForArgs, rates: IPriceCalcSkuRates): IAiToolResult {
  const { sku, tax, window, sourceLabels } = rates;
  if (!sku.rates) return insufficient(NO_PRICE_RATES_TEXT(args.sku));
  if (sku.cogsKopecks === null) return insufficient(NO_PRICE_COGS_TEXT(args.sku));
  const input = {
    discountRate: args.discountRate,
    commissionRate: sku.rates.commissionRate,
    promotionRate: sku.rates.promotionRate,
    cogsKopecks: sku.cogsKopecks,
    logisticsKopecks: sku.rates.logisticsKopecks,
    otherKopecks: sku.rates.otherKopecks,
    tax: { mode: tax.mode, rate: tax.rate, minRate: tax.minRate },
  };
  const solution = priceFor(args.target, input);
  // strictNullChecks выключен — union не сужается, поля читаются через cast.
  if (!solution.ok)
    return insufficient(PRICE_CALC_FAILURE_TEXT[(solution as { reason: 'rates' }).reason]);
  const r = profitAt((solution as { priceKopecks: number }).priceKopecks, input);
  return {
    ok: true,
    data: {
      kind: 'расчёт',
      note: `Расчёт по ставкам за ${PRICE_CALC_WINDOW_DAYS} дней, не тариф Маркета`,
      sku: args.sku,
      name: sku.name,
      target:
        args.target.kind === 'profit'
          ? { profitPerUnit: money(args.target.kopecks) }
          : { marginPercent: percent(args.target.rate) },
      discountPercent: percent(args.discountRate),
      price: money(r.priceKopecks),
      perUnit: {
        discount: money(r.discountKopecks),
        sale: money(r.saleKopecks),
        commission: money(r.commissionKopecks),
        promotion: money(r.promotionKopecks),
        cogs: money(r.cogsKopecks),
        logistics: money(r.logisticsKopecks),
        other: money(r.otherKopecks),
        tax: money(r.taxKopecks),
        profit: money(r.profitKopecks),
        marginPercent: percent(r.margin),
      },
      rates: {
        commissionPercent: percent(sku.rates.commissionRate),
        promotionPercent: percent(sku.rates.promotionRate),
        source: sourceLabels[sku.ratesSource],
        cogsSource: sourceLabels[sku.cogsSource],
        tax: `${tax.regimeLabel}, ${percent(tax.rate)} % (${sourceLabels[tax.source]})`,
      },
      window,
    },
    sourceRefs: sourceRefs('finance:price-calc', window, []),
  };
}

/** Расходы периода — тот же `allocatedFor`, что P&L и раздел «Расходы». */
export function expensesResult(
  period: IFinancePeriod,
  allocation: IExpenseAllocation,
  categories: readonly TFinanceExpenseCategoryRow[],
): IAiToolResult {
  if (!allocation.totalKopecks) return insufficient(NO_EXPENSES_TEXT);
  return {
    ok: true,
    data: {
      period,
      total: money(allocation.totalKopecks),
      byCategory: categoriesOf(allocation.byCategory, categories),
    },
    sourceRefs: sourceRefs('finance:expenses', period, []),
  };
}

// ── Живые данные Маркета (TASK-166) ────────────────────────────────────────

export const YM_NOT_CONNECTED_TEXT = 'Магазин Яндекс Маркета не подключён — данных нет';
export const STORE_INVALID_TEXT = 'store: название магазина строкой';
export const STORE_NOT_FOUND_TEXT = (name: string, names: readonly string[]): string =>
  `Магазина «${name}» нет среди магазинов продавца` +
  (names.length ? `; есть: ${names.join(', ')}` : '');
export const STORE_AMBIGUOUS_TEXT = (name: string): string =>
  `Магазинов с названием «${name}» несколько — данные одного из них выдавались бы за другой`;
export const RETURNS_PERIOD_INVALID_TEXT = `period: одно из ${RETURNS_PERIODS.join(', ')}`;
export const STOCKS_QUERY_INVALID_TEXT = `query: часть названия или артикула, от ${MIN_SEARCH_QUERY} символов`;
export const NO_STOCKS_TEXT = 'Маркет не вернул ни одного остатка по магазину';

/** Магазин живого инструмента: документ, суженный до кампании, и названия для модели. */
export interface ILiveStore {
  store: YandexMarketDocument;
  name: string;
  names: string[];
}

/**
 * Магазин из аргумента `store` (название) — только из кэша `stores` токена,
 * через тот же `scopeStore`, что магазин из адреса CRM: чужая кампания туда не
 * попадает, значит и модель её не откроет. Без аргумента — активный магазин бота.
 */
export function liveStoreOf(doc: YandexMarketDocument | null, raw: unknown): ILiveStore | string {
  if (!doc?.token || !doc.campaign_id) return YM_NOT_CONNECTED_TEXT;
  if (raw !== undefined && typeof raw !== 'string') return STORE_INVALID_TEXT;
  const entries = doc.stores ?? [];
  const names = [...new Set(entries.map((entry) => entry.storeName).filter(Boolean))];
  const active = entries.find((entry) => entry.campaignId === String(doc.campaign_id));
  const activeName = active?.storeName ?? doc.name ?? '';
  if (!names.length && activeName) names.push(activeName);

  const wanted = typeof raw === 'string' ? raw.trim() : '';
  if (!wanted || wanted.toLowerCase() === activeName.toLowerCase()) {
    // Активный магазин открыт всегда — и у старого документа без кэша `stores`.
    return { store: doc, name: activeName, names };
  }
  const matches = entries.filter(
    (entry) => entry.storeName?.toLowerCase() === wanted.toLowerCase(),
  );
  if (matches.length > 1) return STORE_AMBIGUOUS_TEXT(wanted);
  const scoped = matches.length ? scopeStore(doc, matches[0].campaignId) : null;
  if (!scoped) return STORE_NOT_FOUND_TEXT(wanted, names);
  return { store: scoped, name: matches[0].storeName, names };
}

export interface IStocksFilter {
  brand?: TBrandKey | null;
  query?: string;
  onlyLow: boolean;
}

export function stocksFilterArg(args: TArgs): IStocksFilter | string {
  const brand = brandArg(args);
  if (brand === false) return BRAND_INVALID_TEXT;
  let query: string | undefined;
  if (args.query !== undefined) {
    if (typeof args.query !== 'string' || args.query.trim().length < MIN_SEARCH_QUERY) {
      return STOCKS_QUERY_INVALID_TEXT;
    }
    query = args.query.trim().toLowerCase();
  }
  if (args.onlyLow !== undefined && typeof args.onlyLow !== 'boolean')
    return 'onlyLow: true или false';
  return { brand, query, onlyLow: args.onlyLow === true };
}

/** Текст бота о недоступных остатках — без значка: модель пересказывает его словами. */
export const stocksUnavailableText = (error?: TFbyStockError): string =>
  fbyStockUnavailableLine(error).replace(/^\S+\s+/, '');

/**
 * Остатки — ровно `StockLevelsService.levels` (то же число, что «Склад» и
 * главная CRM): здесь только фильтр и обрезка. Название и бренд — из каталога
 * (`Product`), как в `getBrandEconomics`; товар вне каталога — без названия.
 */
export function stocksResult(
  levels: IStockLevels,
  products: ReadonlyMap<string, IBrandSource>,
  filter: IStocksFilter,
  live: Omit<ILiveStore, 'store'>,
): IAiToolResult {
  if (!levels.stocks) return toolError(stocksUnavailableText(levels.error));
  const all = Object.entries(levels.stocks);
  if (!all.length) return insufficient(NO_STOCKS_TEXT);

  const rows = all
    .map(([sku, available]) => {
      const product = products.get(sku);
      const brand = product ? brandOf(product) : null;
      return {
        sku,
        name: product?.name ?? null,
        brand: brand ? brandTitle(brand) : null,
        brandKey: brand ?? OTHER_BRAND_ARG,
        available,
        low: available <= LOW_STOCK_THRESHOLD,
      };
    })
    .filter(
      (row) => filter.brand === undefined || row.brandKey === (filter.brand ?? OTHER_BRAND_ARG),
    )
    .filter(
      (row) =>
        !filter.query ||
        row.sku.toLowerCase().includes(filter.query) ||
        Boolean(row.name?.toLowerCase().includes(filter.query)),
    )
    .filter((row) => !filter.onlyLow || row.low)
    .sort((a, b) => a.available - b.available || a.sku.localeCompare(b.sku));

  return {
    ok: true,
    data: {
      store: live.name,
      stores: live.names,
      model: isFby(levels.placement) ? 'FBY' : 'FBS',
      takenAt: levels.takenAt ? levels.takenAt.toISOString() : null,
      threshold: LOW_STOCK_THRESHOLD,
      total: rows.length,
      lowCount: rows.filter((row) => row.low).length,
      units: rows.reduce((sum, row) => sum + row.available, 0),
      rows: rows.slice(0, MAX_TOOL_STOCK_ROWS).map(({ brandKey: _key, ...row }) => row),
    },
    sourceRefs: { ...sourceRefs('yandex:stocks', undefined, []), label: 'Остатки Маркета сейчас' },
  };
}

export function returnsPeriodArg(args: TArgs): TPeriodKey | null {
  if (args.period === undefined) return DEFAULT_PERIOD.key;
  return RETURNS_PERIODS.find((key) => key === args.period) ?? null;
}

/**
 * Возвраты — ровно `OrderReportsService.build(RETURNING)`, тот же вызов, что
 * у бота и выгрузки «Едет обратно» (`exportReturning`): числа не пересчитываются.
 */
export function returnsResult(
  report: IReportResult,
  live: Omit<ILiveStore, 'store'>,
  now: Date,
): IAiToolResult {
  const returns = report.returns;
  return {
    ok: true,
    data: {
      store: live.name,
      stores: live.names,
      period: periodTitle(report.period, now),
      orders: report.count,
      sales: report.totals.sales,
      subsidies: report.totals.subsidies,
      withDelivery: report.totals.withDelivery,
      returns: returns
        ? {
            count: returns.count,
            inFlight: returns.inFlight,
            settled: returns.settled,
            records: returns.records.slice(0, MAX_TOOL_RETURN_RECORDS).map((record) => ({
              orderId: record.orderId,
              shipmentStatus: record.shipmentStatus ?? null,
              refundStatus: record.refundStatus ?? null,
              createdAt: record.creationDate ?? null,
              amount: record.amount?.value ?? null,
            })),
          }
        : null,
      note: 'Суммы — рубли, как в отчёте «Едет обратно»; orders уже включает возвраты.',
    },
    sourceRefs: { ...sourceRefs('yandex:returning', undefined, []), label: 'Отчёт «Едет обратно»' },
  };
}
