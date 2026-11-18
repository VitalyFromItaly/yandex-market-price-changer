import type { ICalendarDate } from '../reports/moscow-day';
import type { IProfitPlaceRow, IProfitSku, IProfitTotals } from '../reports/profit';
import type { IProfitReport } from '../reports/profit.service';
import type { IReportPeriod, TPeriodKey } from '../reports/report-period';

import { b, esc } from '../../telegram/formatting/telegram-format';
import { formatRubles } from '../reports/money';
import { profitMainBlock } from '../reports/profit-message';
import { PERIOD, periodButtonLabel, periodTitle } from '../reports/report-period';

/**
 * «🏆 Топ товаров» — чистая часть (своего флага нет, экран под `report_profit`,
 * src/modules/yandex/README.md «Топ товаров и регионы»).
 *
 * Своей формулы здесь НЕТ: строки — `bySku` того же `profitOf`, что «Прибыль» и карточка
 * Главной CRM, поэтому Σ по товарам = продажи «Прибыли» за тот же период по построению.
 * Набор — основной блок прибыли (`profitMainBlock`): оформленные, а без них выкупленные.
 * Отличие от карточки Главной одно: здесь ВСЕ товары и любой период.
 */

/** Набор заказов, по которому построен топ, — тот же выбор, что у «Прибыли». */
export type TTopSkusScope = 'placed' | 'redeemed';

export interface ITopSkusView {
  period: IReportPeriod;
  scope: TTopSkusScope;
  /** Итог основного блока: заказы, продажи, чистая. */
  orders: number;
  revenue: number;
  net: number;
  /** Все проданные товары, по убыванию продаж; возвраты — только штуками. */
  skus: IProfitSku[];
  /** Разрезы по месту — при `places` в сборке прибыли. */
  byRegion?: IProfitPlaceRow[];
  byCluster?: IProfitPlaceRow[];
  /** Заказы без закупа: в чистой их нет, сказать о них экран обязан. */
  unconfirmedOrders: number;
}

/** Отчёт прибыли → вид топа. Товары без продаж (только возвраты) остаются: их видно штуками. */
export function topSkusOf(report: IProfitReport): ITopSkusView {
  const scope = profitMainBlock(report);
  const block: IProfitTotals = scope === 'placed' ? report.placed : report.totals;
  return {
    period: report.period,
    scope,
    orders: block.orders,
    revenue: block.revenue,
    net: block.net,
    skus: block.bySku ?? [],
    byRegion: block.byRegion,
    byCluster: block.byCluster,
    unconfirmedOrders: block.unconfirmed?.orders ?? 0,
  };
}

/** Подпись набора — экран обязан сказать, какие заказы он считал. */
export const TOP_SKUS_SCOPE_LABEL: Record<TTopSkusScope, string> = {
  placed: 'по оформленным заказам',
  redeemed: 'по выкупленным заказам (оформленных за период нет)',
};

// --- кнопки бота -------------------------------------------------------------

/** Периоды кнопок бота. «Прошлый месяц» — только с архивом (deep_history), как у «Прибыли». */
export function topSkusPeriods(options: { prevMonth: boolean }): TPeriodKey[][] {
  const rows: TPeriodKey[][] = [
    [PERIOD.TODAY, PERIOD.WEEK],
    [PERIOD.MONTH, PERIOD.RANGE],
  ];
  if (options.prevMonth) rows.push([PERIOD.PREV_MONTH]);
  return rows;
}

export { TOP_CB_PATTERN, parseTopCallback, topCallback } from './top-skus.callbacks';

/** Метка незакрытого вопроса «за какой период?» в `UserAccess.pendingReportDay`. */
export const TOP_SKUS_PENDING = 'top_skus:range';

export const topSkusPeriodButtonLabel = periodButtonLabel;

export function topSkusAskPeriodText(): string {
  return '🏆 <b>Топ товаров</b> — за какой период?';
}

export function topSkusAskRangeText(deepHistory: boolean): string {
  return [
    '✏️ Пришлите период двумя датами — например <code>01-10-2026 31-10-2026</code>.',
    '',
    deepHistory
      ? 'ℹ️ Можно и старше 30 дней — данные придут из архива Маркета. Не длиннее года.'
      : '⚠️ Яндекс.Маркет хранит заказы не старше 30 дней.',
  ].join('\n');
}

export const TOP_SKUS_BAD_RANGE_TEXT =
  'Не понял период. Нужны две даты ДД-ММ-ГГГГ, например <code>01-10-2026 31-10-2026</code>.';
export const TOP_SKUS_QUEUED_TEXT = '⏳ Собираю топ товаров, пришлю, как будет готово…';
export const TOP_SKUS_LOCKED_TEXT = '🔒 Этот экран сейчас недоступен.';

// --- текст бота ----------------------------------------------------------------

/** Сколько товаров в сообщении; все — в файле. */
export const TOP_SKUS_MESSAGE_ROWS = 15;
/** Сколько регионов/кластеров в сообщении; все — в файле. */
export const TOP_PLACES_MESSAGE_ROWS = 5;

export const TOP_SKUS_EMPTY_TEXT = 'За этот период продаж нет.';

function percent(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : '—';
}

function placeLines(title: string, rows: IProfitPlaceRow[] | undefined, whole: number): string[] {
  if (!rows?.length) return [];
  return [
    '',
    b(title),
    ...rows
      .slice(0, TOP_PLACES_MESSAGE_ROWS)
      .map(
        (row) =>
          `• ${esc(row.name)} — ${b(formatRubles(row.revenue))} (${percent(row.revenue, whole)}), ` +
          `${row.count} шт.`,
      ),
  ];
}

/** Сообщение бота: итог, первые 15 товаров и первые 5 регионов/кластеров. Все строки — в файле. */
export function formatTopSkus(view: ITopSkusView, now: Date = new Date()): string {
  const header = `🏆 ${b('Топ товаров')} ${esc(periodTitle(view.period, now))}`;
  const sold = view.skus.filter((row) => row.count > 0);
  if (!sold.length) return [header, '', TOP_SKUS_EMPTY_TEXT].join('\n');

  const lines = [
    header,
    esc(TOP_SKUS_SCOPE_LABEL[view.scope]),
    '',
    `Товаров продано: ${b(sold.length)}, заказов: ${b(view.orders)}`,
    `💰 Продажи: ${b(formatRubles(view.revenue))}, чистая: ${b(formatRubles(view.net))}`,
    '',
    ...sold
      .slice(0, TOP_SKUS_MESSAGE_ROWS)
      .map(
        (row, index) =>
          `${index + 1}. ${esc(row.name)} (<code>${esc(row.sku)}</code>) — ${row.count} шт., ` +
          `${b(formatRubles(row.revenue))}, чистая ${formatRubles(row.net)}`,
      ),
  ];
  if (sold.length > TOP_SKUS_MESSAGE_ROWS) {
    lines.push('', `Остальные ${sold.length - TOP_SKUS_MESSAGE_ROWS} — в файле.`);
  }
  lines.push(...placeLines('📍 Регионы покупателей', view.byRegion, view.revenue));
  lines.push(...placeLines('🏭 Кластеры отгрузки', view.byCluster, view.revenue));
  if (view.unconfirmedOrders) {
    lines.push(
      '',
      `⚠️ Без закупочной цены: ${view.unconfirmedOrders} заказ(ов) — в топе их нет. ` +
        'Загрузите прайс с этими товарами.',
    );
  }
  return lines.join('\n');
}

/** Имя файла: `top-skus_ДД-ММ-ГГГГ_ДД-ММ-ГГГГ.xlsx`. */
export function topSkusFilename(bounds: { from: ICalendarDate; to: ICalendarDate }): string {
  const fmt = (d: ICalendarDate): string =>
    `${String(d.day).padStart(2, '0')}-${String(d.month).padStart(2, '0')}-${d.year}`;
  return `top-skus_${fmt(bounds.from)}_${fmt(bounds.to)}.xlsx`;
}
