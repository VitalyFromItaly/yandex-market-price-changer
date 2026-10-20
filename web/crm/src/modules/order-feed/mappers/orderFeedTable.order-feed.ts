import type {
  OrderFeedArticle,
  OrderFeedFilters,
  OrderFeedMarketplace,
  OrderFeedRow,
  OrderFeedTotals,
  OrderStage,
} from '../order-feed.domain';

import { PROFIT_GAP_TEXT } from '../order-feed.domain';

import { formatCount, formatDay, formatKopecks, formatRub, plural } from '@/shared/utils';

const MARKETPLACES: readonly OrderFeedMarketplace[] = ['ym', 'ozon', 'wb'];

/** Строки под фильтры: площадка, этап, товар (артикул или название, без регистра). */
export function filterRows(
  rows: readonly OrderFeedRow[],
  filters: OrderFeedFilters,
): OrderFeedRow[] {
  const needle = filters.product.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (filters.marketplace === null || row.marketplace === filters.marketplace) &&
      (filters.stage === null || row.stage === filters.stage) &&
      (needle === '' ||
        row.items.some(
          (item) =>
            item.sku.toLowerCase().includes(needle) ||
            (item.name ?? '').toLowerCase().includes(needle),
        )),
  );
}

/** Прибыль ячейкой: число или причина, почему его нет — не ноль. */
export function profitLabel(row: Pick<OrderFeedRow, 'profitKopecks' | 'profitGap'>): string {
  if (row.profitKopecks !== null) return formatKopecks(row.profitKopecks);
  return row.profitGap ? PROFIT_GAP_TEXT[row.profitGap] : '—';
}

export function moneyOrDash(kopecks: number | null): string {
  return kopecks === null ? '—' : formatKopecks(kopecks);
}

export function salesLabel(sales: number | null): string {
  return sales === null ? '—' : formatRub(sales);
}

export function dayLabel(day: string | null): string {
  return day === null ? '—' : formatDay(day);
}

/** Товары заказа строкой: «Casio A1 × 2, B1». */
export function itemsLabel(row: OrderFeedRow): string {
  return row.items
    .map((item) => {
      const name = item.name || item.sku;
      return item.count > 1 ? `${name} × ${formatCount(item.count)}` : name;
    })
    .join(', ');
}

/** Номер для показа: у Ozon/WB кабинетный номер отличается от номера журнала. */
export function numberLabel(row: OrderFeedRow): string {
  return row.orderNumber || row.id;
}

/** Расходы заказа — статьи группы «расход», от крупных к мелким. */
export function expenseArticles(articles: readonly OrderFeedArticle[]): OrderFeedArticle[] {
  return articles
    .filter((article) => article.group === 'expense' || article.group === 'unknown')
    .sort((a, b) => a.kopecks - b.kopecks);
}

/**
 * Итоги площадок строками — каждая со своей подписью, общего числа нет:
 * площадки не смешиваются в одну сумму.
 */
export function totalsLines(totals: readonly OrderFeedTotals[]): string[] {
  return totals.map((t) => {
    const orders = `${formatCount(t.orders)} ${plural(t.orders, ['заказ', 'заказа', 'заказов'])}`;
    const counted =
      t.profitOrders > 0
        ? `прибыль ${formatKopecks(t.profitKopecks)} по ${formatCount(t.profitOrders)} с операциями и закупом`
        : 'прибыли пока нет — операций в журнале нет';
    return `${t.label}: ${orders}, ${counted}`;
  });
}

/** Варианты фильтра площадки — только те, что в ответе. */
export function marketplaceOptions(
  present: readonly { marketplace: OrderFeedMarketplace; label: string }[],
): { value: OrderFeedMarketplace | 'all'; label: string }[] {
  const known = MARKETPLACES.filter((mp) => present.some((p) => p.marketplace === mp));
  return [
    { value: 'all', label: 'Все' },
    ...known.map((mp) => ({
      value: mp,
      label: present.find((p) => p.marketplace === mp)?.label ?? mp,
    })),
  ];
}

export function stageOptions(
  stages: readonly { stage: OrderStage; label: string }[],
): { value: OrderStage | 'all'; label: string }[] {
  return [
    { value: 'all', label: 'Все этапы' },
    ...stages.map((s) => ({ value: s.stage, label: s.label })),
  ];
}
