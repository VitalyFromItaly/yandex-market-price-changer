import type {
  TopPlaceRow,
  TopPlaceView,
  TopSkuRow,
  TopSkusRequest,
  TopSkusResponse,
  TopSkusSort,
} from '../top-skus.domain';

import { isoToDay } from '@/shared/period';

/** Params задачи: диапазон бота `range` с датами ДД-ММ-ГГГГ. */
export function topSkusParams(request: TopSkusRequest): Record<string, unknown> {
  return {
    period: { key: 'range', from: isoToDay(request.range.from), to: isoToDay(request.range.to) },
  };
}

/** Ответ — того же диапазона? Замок задачи на kind: быстрое переключение вернёт прежний. */
export function isOwnTopSkus(data: TopSkusResponse, request: TopSkusRequest): boolean {
  return (
    data.period.key === 'range' &&
    data.period.from === isoToDay(request.range.from) &&
    data.period.to === isoToDay(request.range.to)
  );
}

/** Проданные товары (штуки > 0) — с поиском по названию и артикулу и сортировкой. */
export function visibleSkus(
  skus: readonly TopSkuRow[],
  query: string,
  sort: TopSkusSort,
): TopSkuRow[] {
  const needle = query.trim().toLowerCase();
  const rows = skus.filter(
    (row) =>
      row.count > 0 &&
      (needle === '' ||
        row.name.toLowerCase().includes(needle) ||
        row.sku.toLowerCase().includes(needle)),
  );
  const value = (row: TopSkuRow): number =>
    sort === 'margin' ? (row.margin ?? Number.NEGATIVE_INFINITY) : row[sort];
  return rows.sort((a, b) => value(b) - value(a) || b.revenue - a.revenue);
}

/** Строки места с долей от продаж периода. */
export function placeViews(rows: readonly TopPlaceRow[] | null | undefined, total: number) {
  return (rows ?? []).map<TopPlaceView>((row) => ({
    ...row,
    share: total ? row.revenue / total : null,
  }));
}
