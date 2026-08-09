/**
 * Рекомендации Маркета по ценам — типы, разбор ответа и арифметика дельты.
 *
 * Чистый модуль. Ответ `offers/recommendations` несёт И текущую цену каталога
 * (`offer.price`), И пороги привлекательной/умеренной цены — сверка с
 * offer-prices не нужна, дельта считается из одного ответа.
 */

/** Привлекательность цены по Маркету. */
export type TCompetitiveness = 'OPTIMAL' | 'AVERAGE' | 'LOW';

/** Одна рекомендация в терминах отчёта. */
export interface IPriceRecommendation {
  offerId: string;
  /** Текущая цена в каталоге. */
  price?: number;
  /** Максимальная привлекательная цена. */
  optimalPrice?: number;
  /** Максимальная умеренная цена. */
  averagePrice?: number;
  /** Сырая строка: на боевом набор бывает шире спеки. */
  competitiveness: string;
  /** Показы карточки за последние 7 дней. */
  shows?: number;
}

/** Сырая запись из ответа Partner API. */
export type TRawOfferRecommendation = {
  offer?: {
    offerId?: string;
    price?: { value?: number };
    competitiveness?: string;
    shows?: number;
  };
  recommendation?: {
    offerId?: string;
    competitivenessThresholds?: {
      optimalPrice?: { value?: number };
      averagePrice?: { value?: number };
    };
  };
};

/** Разбор одной записи, либо null без артикула. */
export function parseOfferRecommendation(
  raw: TRawOfferRecommendation,
): IPriceRecommendation | null {
  const offerId = raw?.offer?.offerId ?? raw?.recommendation?.offerId;
  if (!offerId) return null;

  return {
    offerId,
    price: numberOrUndefined(raw.offer?.price?.value),
    optimalPrice: numberOrUndefined(
      raw.recommendation?.competitivenessThresholds?.optimalPrice?.value,
    ),
    averagePrice: numberOrUndefined(
      raw.recommendation?.competitivenessThresholds?.averagePrice?.value,
    ),
    competitiveness: raw.offer?.competitiveness ?? 'UNKNOWN',
    shows: numberOrUndefined(raw.offer?.shows),
  };
}

/** Насколько цена выше привлекательного порога. */
export interface IRecommendationDelta {
  /** Рубли: price − optimalPrice. */
  abs: number;
  /** Проценты от порога, округлены до одного знака. */
  percent: number;
}

/**
 * Дельта до привлекательной цены, либо null, когда цены или порога нет.
 * null, а не ноль: строка без данных уходит в свой раздел, молча посчитать её
 * «уже привлекательной» — довод orderPurchase.
 */
export function recommendationDelta(row: IPriceRecommendation): IRecommendationDelta | null {
  if (row.price === undefined || row.optimalPrice === undefined || row.optimalPrice <= 0) {
    return null;
  }
  const abs = row.price - row.optimalPrice;
  return { abs, percent: Math.round((abs / row.optimalPrice) * 1000) / 10 };
}

/** Сортировка «худшие сверху» — по абсолютной дельте, без данных в конец. */
export function sortByDeltaDesc(rows: readonly IPriceRecommendation[]): IPriceRecommendation[] {
  return [...rows].sort((a, b) => {
    const deltaA = recommendationDelta(a);
    const deltaB = recommendationDelta(b);
    if (deltaA === null && deltaB === null) return a.offerId.localeCompare(b.offerId);
    if (deltaA === null) return 1;
    if (deltaB === null) return -1;
    return deltaB.abs - deltaA.abs;
  });
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
