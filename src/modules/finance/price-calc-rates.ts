import type { IFinancePeriod } from './finance-period';
import type { IPnlSku, TSkuColumns } from './pnl-sku';
import type { ITaxSettings } from './tax.domain';
import type { TPriceCalcTaxMode } from '../../shared/price-calc';

import { moscowDay, shiftDays } from '../yandex/reports/moscow-day';

import { SKU_COLUMNS } from './pnl-sku';
import { TAX_REGIME_LABELS, USN_MINIMUM_TAX_BASIS_POINTS } from './tax.domain';

/**
 * Ставки «Калькулятора цен» (TASK-139, ТЗ п.8) для формулы
 * `src/shared/price-calc.ts`: откуда взять каждую ставку и как её подписать.
 * Источник виден у каждой: «факт товара за 30 дней», «факт по всем товарам»,
 * «закуп из прайса», «настройки налогов», а на экране ещё «тариф ЯМ» и «введено».
 *
 * Факт — разрез `pnl.skus` того же `FinanceService.build`, что unit-экономика:
 * доли комиссии и продвижения в выручке и логистика с прочими услугами на
 * штуку — те же колонки, по которым `minPriceOf` считает минимальную цену.
 * Второго разреза журнала нет.
 *
 * Лежит в финмодуле, а не в CRM (TASK-165, прецедент `InventoryService`):
 * те же ставки берёт ИИ-инструмент `getPriceFor`, второй копии сборки нет.
 */

/** Окно факта: последние 30 дней по Москве, включая сегодня. */
export const PRICE_CALC_WINDOW_DAYS = 30;

export type TRateSource =
  | 'fact_sku'
  | 'fact_account'
  | 'price_list'
  | 'tax_settings'
  | 'tax_default'
  | 'tariff'
  | 'manual'
  | 'no_data';

/** Подписи источников — одна таблица на сервер, экран (фронт получает её в ответе) и ИИ. */
export const RATE_SOURCE_LABEL: Readonly<Record<TRateSource, string>> = {
  fact_sku: `факт товара за ${PRICE_CALC_WINDOW_DAYS} дней`,
  fact_account: `факт по всем товарам за ${PRICE_CALC_WINDOW_DAYS} дней`,
  price_list: 'закуп из прайса',
  tax_settings: 'настройки налогов',
  tax_default: 'налог по умолчанию',
  tariff: 'тариф ЯМ',
  manual: 'введено',
  no_data: 'нет данных',
};

export interface ICalcRates {
  /** Комиссия с эквайрингом, доля выручки. */
  commissionRate: number;
  /** Продвижение, доля выручки. */
  promotionRate: number;
  /** Логистика на штуку, копейки. */
  logisticsKopecks: number;
  /** Хранение, обработка, штрафы и прочие услуги на штуку, копейки. */
  otherKopecks: number;
}

export interface ICalcSku {
  sku: string;
  name: string | null;
  units: number;
  /** Средняя цена продажи за окно; null — штук нет. */
  avgPriceKopecks: number | null;
  /** null — ни у товара, ни у аккаунта нет выручки за окно. */
  rates: ICalcRates | null;
  ratesSource: TRateSource;
  /** Закуп штуки; null — ни прайса, ни подтверждённого факта. */
  cogsKopecks: number | null;
  cogsSource: TRateSource;
}

export interface ICalcTax {
  mode: TPriceCalcTaxMode;
  regimeLabel: string;
  rate: number;
  minRate: number;
  source: TRateSource;
}

export interface IPriceCalcRates {
  window: IFinancePeriod;
  /** Средние по всем товарам окна; null — выручки не было. */
  account: ICalcRates | null;
  tax: ICalcTax;
  skus: ICalcSku[];
  sourceLabels: Readonly<Record<TRateSource, string>>;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Последние `PRICE_CALC_WINDOW_DAYS` дней по Москве, включая сегодня. */
export function priceCalcWindow(now: Date = new Date()): IFinancePeriod {
  const today = moscowDay(now);
  const start = shiftDays(today, -(PRICE_CALC_WINDOW_DAYS - 1));
  const iso = (d: { year: number; month: number; day: number }) =>
    `${d.year}-${pad2(d.month)}-${pad2(d.day)}`;
  return { from: iso(start), to: iso(today) };
}

/**
 * Ставки по колонкам журнала. null — выручки или штук нет: доля от нуля и
 * рубли «на ноль штук» ничего не значат. Знак журнала снят: расход — положительный.
 */
export function ratesOfColumns(columns: TSkuColumns, units: number): ICalcRates | null {
  if (!(columns.revenue > 0) || !(units > 0)) return null;
  return {
    commissionRate: -columns.commission / columns.revenue,
    promotionRate: -columns.promotion / columns.revenue,
    logisticsKopecks: Math.round(-columns.logistics / units),
    otherKopecks: Math.round(-columns.otherServices / units),
  };
}

/** Средние по всем товарам окна — фолбэк товара без своих продаж. */
export function accountRatesOf(skus: readonly IPnlSku[]): ICalcRates | null {
  const total = Object.fromEntries(SKU_COLUMNS.map((key) => [key, 0])) as TSkuColumns;
  let units = 0;
  for (const sku of skus) {
    for (const key of SKU_COLUMNS) total[key] += sku.columns[key];
    units += sku.units;
  }
  return ratesOfColumns(total, units);
}

/** Налог для формулы: режим, ставка, минимальный налог «Д−Р». */
export function calcTaxOf(settings: ITaxSettings, isDefault: boolean): ICalcTax {
  const profit = settings.regime === 'usn_income_minus_expenses';
  return {
    mode: profit ? 'profit' : 'revenue',
    regimeLabel: TAX_REGIME_LABELS[settings.regime],
    rate: settings.rateBasisPoints / 10_000,
    minRate: profit ? USN_MINIMUM_TAX_BASIS_POINTS / 10_000 : 0,
    source: isDefault ? 'tax_default' : 'tax_settings',
  };
}

/**
 * Товар калькулятора. Закуп — сперва текущий из прайса (цена решается на
 * будущее, и закуп нужен сегодняшний), потом факт окна, если он подтверждён.
 */
export function calcSkuOf(
  sku: IPnlSku,
  account: ICalcRates | null,
  name: string | null,
  priceListKopecks: number | undefined,
): ICalcSku {
  const own = ratesOfColumns(sku.columns, sku.units);
  let ratesSource: TRateSource = 'no_data';
  if (own) ratesSource = 'fact_sku';
  else if (account) ratesSource = 'fact_account';
  const factCogs = sku.costKnown && sku.units > 0 ? Math.round(sku.cogsKopecks / sku.units) : null;
  let cogsKopecks: number | null = null;
  let cogsSource: TRateSource = 'no_data';
  if (priceListKopecks !== undefined) {
    cogsKopecks = priceListKopecks;
    cogsSource = 'price_list';
  } else if (factCogs !== null) {
    cogsKopecks = factCogs;
    cogsSource = 'fact_sku';
  }

  return {
    sku: sku.sku,
    name,
    units: sku.units,
    avgPriceKopecks: sku.units > 0 ? Math.round(sku.columns.revenue / sku.units) : null,
    rates: own ?? account,
    ratesSource,
    cogsKopecks,
    cogsSource,
  };
}

/** Ответ ставок: товары по выручке, крупные первыми. */
export function toPriceCalcRates(input: {
  window: IFinancePeriod;
  skus: readonly IPnlSku[];
  names: ReadonlyMap<string, string>;
  priceList: ReadonlyMap<string, number>;
  tax: ICalcTax;
}): IPriceCalcRates {
  const account = accountRatesOf(input.skus);
  const skus = [...input.skus]
    .sort((a, b) => b.columns.revenue - a.columns.revenue || a.sku.localeCompare(b.sku))
    .map((sku) =>
      calcSkuOf(sku, account, input.names.get(sku.sku) ?? null, input.priceList.get(sku.sku)),
    );
  return {
    window: input.window,
    account,
    tax: input.tax,
    skus,
    sourceLabels: RATE_SOURCE_LABEL,
  };
}

/**
 * Товар без продаж в окне (TASK-165, `getPriceFor`): своих ставок нет — средние
 * по аккаунту, закуп — только прайс (подтверждённого факта без продаж не бывает).
 */
export function calcSkuWithoutSales(
  sku: string,
  account: ICalcRates | null,
  name: string | null,
  priceListKopecks: number | undefined,
): ICalcSku {
  const listed = priceListKopecks !== undefined;
  return {
    sku,
    name,
    units: 0,
    avgPriceKopecks: null,
    rates: account,
    ratesSource: account ? 'fact_account' : 'no_data',
    cogsKopecks: listed ? priceListKopecks : null,
    cogsSource: listed ? 'price_list' : 'no_data',
  };
}

/** Ставки одного товара — то, что экран показал бы на его строке. */
export interface IPriceCalcSkuRates {
  window: IFinancePeriod;
  tax: ICalcTax;
  sku: ICalcSku;
  sourceLabels: Readonly<Record<TRateSource, string>>;
}
