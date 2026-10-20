import type { InventoryColumn, InventoryResponse } from '../inventory.domain';

import { formatCount, formatKopecks, formatMoscowDate, plural } from '@/shared/utils';

export interface InventorySummaryCard {
  key: 'own' | 'marketplaces' | 'without-cost';
  label: string;
  value: string;
  caption: string;
}

/** Три числа шапки: свой склад и склады площадок по себестоимости — раздельно, без суммы FBS. */
export function summaryCards(data: InventoryResponse): InventorySummaryCard[] {
  const { totals } = data;
  const placeNames = data.columns
    .filter((column) => column.state === 'ok')
    .map((column) => column.places.marketplace)
    .join(', ');
  return [
    {
      key: 'own',
      label: 'Свой склад',
      value: formatKopecks(totals.ownKopecks),
      caption: data.ownStockAt
        ? `по себестоимости · прайс от ${formatMoscowDate(data.ownStockAt) ?? '—'}`
        : 'по себестоимости · прайс с остатками не загружали',
    },
    {
      key: 'marketplaces',
      label: 'На складах площадок',
      value: formatKopecks(totals.marketplaceKopecks),
      caption: placeNames ? `по себестоимости · ${placeNames}` : 'площадки не дали остатков',
    },
    {
      key: 'without-cost',
      label: 'Без себестоимости',
      value: `${formatCount(totals.withoutCost.units)} шт.`,
      caption:
        totals.withoutCost.products === 0
          ? 'у всех товаров с остатком закуп известен'
          : `${formatCount(totals.withoutCost.products)} ${plural(totals.withoutCost.products, [
              'товар',
              'товара',
              'товаров',
            ])} — в стоимость не вошли`,
    },
  ];
}

/** Колонки площадок, по которым есть числа; неподключённые объясняются строкой проблем. */
export function tableColumns(data: InventoryResponse): InventoryColumn[] {
  return data.columns.filter((column) => column.state === 'ok');
}

/** «Ozon — 18-10-2026 12:00»: когда каждая площадка дала остатки. */
export function takenAtLines(data: InventoryResponse): string[] {
  return tableColumns(data)
    .filter((column) => column.takenAt !== null)
    .map((column) => `${column.label} — ${formatMoscowDate(column.takenAt ?? '') ?? '—'}`);
}
