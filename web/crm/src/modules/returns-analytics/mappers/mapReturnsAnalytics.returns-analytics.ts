import type {
  ReturnFigures,
  ReturnSku,
  ReturnsKpi,
  ReturnsMarketplace,
  ReturnsRow,
} from '../returns-analytics.domain';

import { REST_TITLE } from '../returns-analytics.domain';

import { formatCount, formatKopecks, plural } from '@/shared/utils';

/**
 * Вид «Аналитики возвратов» из ответа задачи. Ничего не пересчитывается:
 * потери, процент и суммы приходят с сервера, здесь — только подписи.
 */

const RATE = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 1 });

/** Доля возвратов; null — выкупов не было, процента нет. */
export function formatRate(rate: number | null): string {
  return rate === null ? '—' : RATE.format(rate);
}

const orders = (n: number) => `${formatCount(n)} ${plural(n, ['заказ', 'заказа', 'заказов'])}`;

export function kpisOf(mp: ReturnsMarketplace): ReturnsKpi[] {
  const t = mp.totals;
  return [
    {
      key: 'units',
      label: 'Возвраты',
      value: `${formatCount(t.returnedUnits)} шт.`,
      caption: orders(t.returnedOrders),
    },
    {
      key: 'rate',
      label: '% от выкупов',
      value: formatRate(t.returnRate),
      caption: `выкуплено ${formatCount(t.soldUnits)} шт.`,
    },
    {
      key: 'amount',
      label: 'Сумма возвратов',
      value: formatKopecks(t.returnedAmountKopecks),
      caption: null,
    },
    {
      key: 'logistics',
      label: 'Обратная логистика',
      value: formatKopecks(t.reverseLogisticsKopecks),
      caption: null,
    },
    {
      key: 'losses',
      label: 'Потери',
      value: formatKopecks(t.lossesKopecks),
      caption: `комиссии ${formatKopecks(t.unreturnedCommissionKopecks)}, удержания ${formatKopecks(
        t.withholdingsKopecks,
      )}, компенсации ${formatKopecks(t.compensationsKopecks)}`,
    },
  ];
}

/** Строка таблицы любого разреза — одна функция, чтобы колонки значили одно и то же. */
export function toReturnsRow(
  key: string,
  title: string,
  subtitle: string | null,
  f: ReturnFigures,
): ReturnsRow {
  return {
    key,
    title,
    subtitle,
    units: formatCount(f.returnedUnits),
    orders: formatCount(f.returnedOrders),
    rate: formatRate(f.returnRate),
    amount: formatKopecks(f.returnedAmountKopecks),
    logistics: formatKopecks(f.reverseLogisticsKopecks),
    withholdings: formatKopecks(f.withholdingsKopecks),
    commission: formatKopecks(f.unreturnedCommissionKopecks),
    compensations: formatKopecks(f.compensationsKopecks),
    losses: formatKopecks(f.lossesKopecks),
    lossesKopecks: f.lossesKopecks,
  };
}

export function brandRows(mp: ReturnsMarketplace): ReturnsRow[] {
  return mp.brands.map((b) =>
    toReturnsRow(
      `brand:${b.key ?? ''}`,
      b.title,
      `${formatCount(b.skus)} ${plural(b.skus, ['товар', 'товара', 'товаров'])}`,
      b,
    ),
  );
}

export function skuRow(sku: ReturnSku): ReturnsRow {
  return toReturnsRow(`sku:${sku.sku}`, sku.name ?? sku.sku, sku.name ? sku.sku : null, sku);
}

const isEmptyFigures = (f: ReturnFigures): boolean =>
  f.returnedUnits === 0 &&
  f.returnedOrders === 0 &&
  f.returnedAmountKopecks === 0 &&
  f.reverseLogisticsKopecks === 0 &&
  f.withholdingsKopecks === 0 &&
  f.compensationsKopecks === 0 &&
  f.unreturnedCommissionKopecks === 0;

/** «Не отнесено к товару»; null — там пусто, строку не показываем. */
export function restRow(mp: ReturnsMarketplace): ReturnsRow | null {
  return isEmptyFigures(mp.rest) ? null : toReturnsRow('rest', REST_TITLE, null, mp.rest);
}

export function totalRow(mp: ReturnsMarketplace): ReturnsRow {
  return toReturnsRow('total', 'Итого', null, mp.totals);
}

/** За период возвратов и их расходов нет — экран показывает пустое состояние. */
export function isQuiet(mp: ReturnsMarketplace): boolean {
  return isEmptyFigures(mp.totals);
}

/** Поиск по названию и артикулу; порядок — серверный (по потерям). */
export function filterReturnSkus(skus: readonly ReturnSku[], query: string): ReturnSku[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...skus];
  return skus.filter(
    (sku) =>
      sku.sku.toLowerCase().includes(needle) || (sku.name ?? '').toLowerCase().includes(needle),
  );
}
