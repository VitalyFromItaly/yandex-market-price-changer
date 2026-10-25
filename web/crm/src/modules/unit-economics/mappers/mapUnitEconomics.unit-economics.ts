import type {
  Tone,
  UnitCardLine,
  UnitEconomicsResponse,
  UnitRow,
  UnitSku,
  UnitSort,
} from '../unit-economics.domain';
import type { MarketplaceKey } from '@/navigation.sections';

import { unconfirmedSummary } from '../../../../../../src/shared/profit-confirmation';
import { UNIT_PLATFORMS } from '../unit-economics.domain';

import { formatCount, formatKopecks } from '@/shared/utils';

const dash = '—';

const money = (kopecks: number | null): string =>
  kopecks === null ? dash : formatKopecks(kopecks);

/** Доля как процент с одним знаком: 0.234 → «23,4 %». */
export function formatShare(value: number | null): string {
  if (value === null) return dash;
  return `${(value * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} %`;
}

const toneOf = (kopecks: number): Tone => {
  if (kopecks > 0) return 'ok';
  return kopecks < 0 ? 'danger' : 'muted';
};

/** «+1 200 ₽» / «−300 ₽» — изменение чистой к прошлому периоду. */
export function formatDelta(kopecks: number): string {
  if (kopecks === 0) return formatKopecks(0);
  return `${kopecks > 0 ? '+' : '−'}${formatKopecks(Math.abs(kopecks))}`;
}

export function toUnitRow(sku: UnitSku): UnitRow {
  const delta = sku.previous === null ? null : sku.netKopecks - sku.previous.netKopecks;
  return {
    sku: sku.sku,
    title: sku.name ?? sku.sku,
    subtitle: sku.name ? sku.sku : null,
    scheme: sku.scheme,
    units: formatCount(sku.units),
    revenue: formatKopecks(sku.columns.revenue),
    net: sku.costKnown ? formatKopecks(sku.netKopecks) : `≤ ${formatKopecks(sku.netKopecks)}`,
    netTone: toneOf(sku.netKopecks),
    margin: formatShare(sku.margin),
    unitNet: money(sku.unitNetKopecks),
    delta: delta === null ? null : formatDelta(delta),
    deltaTone: delta === null ? 'muted' : toneOf(delta),
    costKnown: sku.costKnown,
  };
}

const sortValue = (sku: UnitSku, sort: UnitSort): number => {
  if (sort === 'net') return sku.netKopecks;
  if (sort === 'margin') return sku.margin ?? Number.NEGATIVE_INFINITY;
  return sku.columns.revenue;
};

/** Поиск по названию и артикулу без регистра, затем сортировка по убыванию. */
export function filterSkus(skus: readonly UnitSku[], query: string, sort: UnitSort): UnitSku[] {
  const needle = query.trim().toLocaleLowerCase('ru-RU');
  return skus
    .filter(
      (sku) =>
        needle === '' ||
        sku.sku.toLocaleLowerCase('ru-RU').includes(needle) ||
        (sku.name ?? '').toLocaleLowerCase('ru-RU').includes(needle),
    )
    .sort((a, b) => sortValue(b, sort) - sortValue(a, sort) || a.sku.localeCompare(b.sku));
}

/** Расход со знаком журнала → положительная сумма для строки «Комиссия: 1 200 ₽». */
const expense = (kopecks: number) => formatKopecks(-kopecks);

/**
 * Таблица карточки товара: показатели сверху вниз, площадки — колонками.
 * Деньги за период и на штуку, доли — от выручки (подсказка строки).
 */
export function unitCardLines(sku: UnitSku): UnitCardLine[] {
  const c = sku.columns;
  const lines: UnitCardLine[] = [
    {
      label: 'Продано, шт.',
      ym: formatCount(sku.units),
      hint: `заказов: ${formatCount(sku.orders)}`,
    },
    { label: 'Средняя цена продажи', ym: money(sku.avgPriceKopecks) },
    { label: 'Выручка', ym: formatKopecks(c.revenue), strong: true },
    {
      label: 'Себестоимость',
      ym: sku.costKnown
        ? formatKopecks(sku.cogsKopecks)
        : `${formatKopecks(sku.cogsKopecks)} — не подтверждено`,
      hint: `${money(sku.unitCostKopecks)} за шт. · ${formatShare(sku.shares.cogs)}`,
      tone: sku.costKnown ? undefined : 'danger',
    },
    {
      label: 'Комиссия и эквайринг',
      ym: expense(c.commission),
      hint: formatShare(sku.shares.commission),
    },
    { label: 'Логистика', ym: expense(c.logistics), hint: formatShare(sku.shares.logistics) },
    {
      label: 'Реклама и продвижение',
      ym: expense(c.promotion),
      hint: formatShare(sku.shares.promotion),
    },
    {
      label: 'Прочие услуги площадки',
      ym: expense(c.otherServices),
      hint: formatShare(sku.shares.otherServices),
    },
    {
      label: 'Налог (доля периода)',
      ym: formatKopecks(sku.taxKopecks),
      hint: formatShare(sku.shares.tax),
    },
  ];
  if (c.otherIncome !== 0)
    lines.push({ label: 'Компенсации и прочие доходы', ym: formatKopecks(c.otherIncome) });
  if (c.unrecognized !== 0)
    lines.push({ label: 'Не распознано', ym: formatKopecks(c.unrecognized) });
  lines.push(
    {
      label: 'Прибыль за период',
      ym: formatKopecks(sku.netKopecks),
      tone: toneOf(sku.netKopecks),
      strong: true,
    },
    {
      label: 'Прибыль на штуку',
      ym: money(sku.unitNetKopecks),
      tone: toneOf(sku.unitNetKopecks ?? 0),
    },
    { label: 'Рентабельность', ym: formatShare(sku.margin) },
    { label: 'Минимальная цена без убытка', ym: money(sku.minPriceKopecks) },
  );
  if (sku.previous) {
    const delta = sku.netKopecks - sku.previous.netKopecks;
    lines.push({
      label: 'Прибыль к прошлому периоду',
      ym: formatDelta(delta),
      hint: `было ${formatKopecks(sku.previous.netKopecks)} · ${formatCount(sku.previous.units)} шт.`,
      tone: toneOf(delta),
    });
  }
  return lines;
}

/**
 * Плашка над таблицей: признак движка как есть — сколько заказов и на какую
 * сумму продано без закупа. null — прибыль подтверждена.
 */
export function unconfirmedNote(data: UnitEconomicsResponse): string | null {
  const summary = unconfirmedSummary(data.unconfirmed, formatKopecks);
  return summary ? `${summary}. Прибыль этих товаров завышена.` : null;
}

export interface UnitPlatform {
  key: MarketplaceKey;
  label: string;
  ready: boolean;
}

/**
 * Колонки карточки товара на экране площадки (TASK-181): числа — первой колонкой
 * у площадки экрана. На ЯМ — как было (Ozon/WB «скоро»); на Ozon/WB — только своя
 * колонка: рядом площадки сравнивает «Сравнение площадок», а не карточка.
 */
export function unitPlatforms(marketplace: MarketplaceKey): UnitPlatform[] {
  if (marketplace === 'ym') return UNIT_PLATFORMS.map((p) => ({ ...p }));
  return UNIT_PLATFORMS.filter((p) => p.key === marketplace).map((p) => ({ ...p, ready: true }));
}
