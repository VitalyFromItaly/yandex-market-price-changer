/**
 * «Калькулятор цен» (TASK-139, ТЗ п.8): цена → прибыль штуки и обратно — цена
 * для нужной прибыли в рублях или рентабельности. Не путать с «Калькулятором»
 * в «Прибыли»: тот считает P&L периода по тарифам Маркета.
 *
 * Ставки приходят задачей `price-calc:rates` (факт товара за 30 дней из
 * финжурнала), сверка — задачей `price-calc:tariff` по магазину. Формула —
 * общий с бэкендом лист `src/shared/price-calc.ts` (решение
 * `price_calc_shared_leaf`), считается в браузере мгновенно.
 */

export const PRICE_CALCULATOR_ROUTE_NAME = 'ym-price-calculator';
export const PRICE_CALC_RATES_KIND = 'price-calc:rates';
export const PRICE_CALC_TARIFF_KIND = 'price-calc:tariff';
/** Без «Финансов» факта нет: задача ставок получила бы 403 гейта. */
export const FINANCE_FEATURE = 'finance';

// --- ответ задач -------------------------------------------------------------

export type RateSource =
  | 'fact_sku'
  | 'fact_account'
  | 'price_list'
  | 'tax_settings'
  | 'tax_default'
  | 'tariff'
  | 'manual'
  | 'no_data';

export interface CalcRatesResponse {
  commissionRate: number;
  promotionRate: number;
  logisticsKopecks: number;
  otherKopecks: number;
}

export interface CalcSkuResponse {
  sku: string;
  name: string | null;
  units: number;
  avgPriceKopecks: number | null;
  rates: CalcRatesResponse | null;
  ratesSource: RateSource;
  cogsKopecks: number | null;
  cogsSource: RateSource;
}

export interface CalcTaxResponse {
  mode: 'revenue' | 'profit';
  regimeLabel: string;
  rate: number;
  minRate: number;
  source: RateSource;
}

export interface PriceCalcRatesResponse {
  window: { from: string; to: string };
  account: CalcRatesResponse | null;
  tax: CalcTaxResponse;
  skus: CalcSkuResponse[];
  sourceLabels: Record<RateSource, string>;
}

export interface TariffServiceResponse {
  type: string;
  label: string;
  kopecks: number;
  percent: boolean;
}

export interface PriceCalcTariffResponse {
  sku: string;
  priceKopecks: number;
  commissionRate: number;
  logisticsKopecks: number;
  services: TariffServiceResponse[];
}

export interface TariffRequest {
  store: string;
  sku: string;
  priceKopecks: number;
}

// --- форма -------------------------------------------------------------------

/** Ставки, у каждой — значение и источник. Проценты — доли, деньги — копейки. */
export type CalcRateKey = 'commission' | 'promotion' | 'logistics' | 'other' | 'cogs' | 'tax';

export interface CalcRate {
  /** null — источника нет, нужно ввести. */
  value: number | null;
  source: RateSource;
}

export type CalcRates = Record<CalcRateKey, CalcRate>;

export const CALC_RATE_KEYS: readonly CalcRateKey[] = [
  'commission',
  'promotion',
  'logistics',
  'other',
  'cogs',
  'tax',
];

export const CALC_RATE_META: Readonly<
  Record<CalcRateKey, { label: string; unit: 'percent' | 'rub'; hint: string }>
> = {
  commission: {
    label: 'Комиссия и эквайринг',
    unit: 'percent',
    hint: 'процент от цены после скидки',
  },
  promotion: { label: 'Продвижение', unit: 'percent', hint: 'процент от цены после скидки' },
  logistics: { label: 'Логистика', unit: 'rub', hint: 'на штуку' },
  other: { label: 'Прочие услуги', unit: 'rub', hint: 'хранение, обработка, штрафы — на штуку' },
  cogs: { label: 'Закуп', unit: 'rub', hint: 'на штуку' },
  tax: { label: 'Налог', unit: 'percent', hint: 'ставка режима' },
};

export type CalcMode = 'profit' | 'price';
export type TargetKind = 'rub' | 'percent';

export const CALC_MODE_OPTIONS = [
  { value: 'profit', label: 'Цена → прибыль' },
  { value: 'price', label: 'Прибыль → цена' },
] as const;

export const TARGET_KIND_OPTIONS = [
  { value: 'rub', label: 'Прибыль, ₽' },
  { value: 'percent', label: 'Рентабельность, %' },
] as const;

/** Площадки калькулятора: Ozon и WB — «скоро» (решение ozon_wb_skipped_for_now). */
export const CALC_PLATFORMS = [
  { value: 'ym', label: 'Яндекс Маркет', ready: true },
  { value: 'ozon', label: 'Ozon · скоро', ready: false },
  { value: 'wb', label: 'Wildberries · скоро', ready: false },
] as const;

export const NOT_TARIFF_CALC_NOTE =
  'Не путать с «Калькулятором» в «Прибыли»: тот считает прибыль периода по тарифам Маркета, ' +
  'этот — цену одного товара.';

/** Строка разложения результата. */
export interface CalcLine {
  label: string;
  value: string;
  strong?: boolean;
}
