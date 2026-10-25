import type { TMarketplace } from '../../../shared/marketplace';
import type { IUnconfirmedProfit } from '../../../shared/profit-confirmation';
import type { IFinancePeriod } from '../../finance/finance-period';
import type { TFinancePeriodStatus } from '../../finance/finance-period-status';
import type { IPnlReport } from '../../finance/finance.service';
import type {
  IClassSummary,
  IRatingSku,
  RATING_THRESHOLDS,
  TAbcClass,
  TRatingTopKey,
  TXyzClass,
} from '../../finance/sku-ratings';
import type { IBrandSource } from '../../yandex/reports/brands';

import { skuRatingsOf } from '../../finance/sku-ratings';

/**
 * «Рейтинги и классификации» CRM (TASK-141, ТЗ п.9) — доставка, уровня аккаунта.
 *
 * ТОП-листы и классы считает `skuRatingsOf` (finance) над тем же
 * `FinanceService.build`, что «Финансы» и «Аналитика продаж», поэтому выручка
 * товара совпадает с ними по построению. Здесь — только перечисление полей ответа.
 */

export const SKU_RATINGS_KIND = 'sku-ratings:summary';

export const SKU_RATINGS_RANGE_INVALID_TEXT =
  'Период не распознан: нужны даты начала и конца не длиннее года';

export type ICrmRatingSku = IRatingSku;

export interface ICrmRatingTop {
  key: TRatingTopKey;
  title: string;
  rows: ICrmRatingSku[];
}

export interface ICrmSkuRatings {
  /** Площадка журнала (TASK-181) — эхо для сверки ответа с запросом на экране. */
  marketplace: TMarketplace;
  period: IFinancePeriod;
  previousPeriod: IFinancePeriod;
  status: TFinancePeriodStatus;
  statusLabel: string;
  /** Пороги — с сервера: экран печатает их, своих копий у него нет. */
  thresholds: typeof RATING_THRESHOLDS;
  weeks: number;
  xyzUnavailable: string | null;
  tops: ICrmRatingTop[];
  skus: ICrmRatingSku[];
  abcRevenue: IClassSummary<TAbcClass>[];
  abcProfit: IClassSummary<TAbcClass>[];
  xyz: IClassSummary<TXyzClass>[];
  /** Признак движка (TASK-119): товары без закупа в рейтинги прибыли не входят. */
  unconfirmed: IUnconfirmedProfit;
}

const skuOf = (row: IRatingSku): ICrmRatingSku => ({
  sku: row.sku,
  name: row.name,
  brand: row.brand,
  revenueKopecks: row.revenueKopecks,
  netKopecks: row.netKopecks,
  units: row.units,
  costKnown: row.costKnown,
  margin: row.margin,
  previousUnits: row.previousUnits,
  unitsDelta: row.unitsDelta,
  abcRevenue: row.abcRevenue,
  abcProfit: row.abcProfit,
  abcProfitReason: row.abcProfitReason,
  xyz: row.xyz,
  cv: row.cv,
  weeklyUnits: [...row.weeklyUnits],
});

const summaryOf = <T extends string>(rows: IClassSummary<T>[]): IClassSummary<T>[] =>
  rows.map((row) => ({ key: row.key, skus: row.skus, kopecks: row.kopecks, share: row.share }));

/** Ответ раздела: рейтинги текущего периода, спрос — к прошлому. */
export function toCrmSkuRatings(
  current: IPnlReport,
  previous: IPnlReport,
  products: ReadonlyMap<string, IBrandSource>,
  marketplace: TMarketplace = 'ym',
): ICrmSkuRatings {
  const ratings = skuRatingsOf(current.pnl, previous.pnl, products);
  return {
    marketplace,
    period: current.pnl.period,
    previousPeriod: previous.pnl.period,
    status: current.status,
    statusLabel: current.statusLabel,
    thresholds: ratings.thresholds,
    weeks: ratings.weeks,
    xyzUnavailable: ratings.xyzUnavailable,
    tops: ratings.tops.map((top) => ({
      key: top.key,
      title: top.title,
      rows: top.rows.map(skuOf),
    })),
    skus: ratings.skus.map(skuOf),
    abcRevenue: summaryOf(ratings.abcRevenue),
    abcProfit: summaryOf(ratings.abcProfit),
    xyz: summaryOf(ratings.xyz),
    unconfirmed: current.pnl.unconfirmed,
  };
}
