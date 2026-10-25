import type {
  KpiKey,
  KpiSummary,
  OrderRowKey,
  OrderRowSummary,
  UnitEconomicsRow,
} from '../dashboard.domain';
import type { AreaPoint } from '@/components/ui/chart';
import type { FbyResponse } from '@/modules/fby/fby.domain';
import type { OrdersReportResponse } from '@/modules/orders/orders.domain';
import type { ProfitResponse } from '@/modules/profit/profit.domain';

import { KPI, ORDER_ROW } from '../dashboard.domain';

// Исключение из «не импортировать внутренности чужого модуля» (как форма пароля
// в ProfilePage): блок, подпись чистой и заголовок среза берутся из мапперов
// страниц отчётов. Копия «на … МСК» / «Ожидается чистая» разошлась бы с
// экраном, в который ведёт карточка.
import { fillDays } from '@/components/ui/chart';
import { mapFby } from '@/modules/fby/mappers/mapFby.fby';
import { mapOrdersReport } from '@/modules/orders/mappers/mapOrdersReport.orders';
import {
  formatPercent,
  mainBlock,
  profitBreakdown,
} from '@/modules/profit/mappers/mapProfitReport.profit';
import { ALL_MARKETPLACES } from '@/navigation';
import { formatCount, formatRub } from '@/shared/utils';

type ProfitKpi =
  | typeof KPI.SALES
  | typeof KPI.COMMISSION
  | typeof KPI.TAX
  | typeof KPI.PURCHASE
  | typeof KPI.NET;

/** Доля от продаж с одним знаком: «61.5% от продаж». Без продаж доли нет. */
function shareOfSales(value: number, revenue: number): string | null {
  return revenue ? `${formatPercent(Math.round((value / revenue) * 1000) / 10)}% от продаж` : null;
}

/** Деньги карточек и unit-экономики — целыми рублями. */
const rub = (value: number): string => formatRub(Math.round(value));

/**
 * Пять денежных карточек из одного отчёта «Прибыль» — основной блок, как в
 * столбце страницы. Комиссия и налог подписаны НАСТРОЕННЫМ процентом (им они и
 * посчитаны), закуп — фактической долей. Пустой период: нули, а «за период
 * заказов нет» — словами бэкенда на итоговой карточке, не пять раз подряд.
 */
export function mapProfitKpis(response: ProfitResponse): Record<ProfitKpi, KpiSummary> {
  const block = mainBlock(response);
  const breakdown = profitBreakdown(response);
  const net = breakdown.rows.find((row) => row.kind === 'total');
  const heading = response.periodTitle;
  // Карточки — целыми рублями, как бот (formatRubles): «244 987,36 ₽» рядом с
  // «1 531 171 ₽» читается как разная точность одной сводки.
  const card = (value: number, caption: string | null): KpiSummary => ({
    value: rub(value),
    caption: response.empty ? null : caption,
    heading,
    empty: false,
    emptyText: '',
    tone: 'neutral',
  });

  return {
    [KPI.SALES]: card(
      block.revenue,
      `${breakdown.countLabel.toLowerCase()} ${formatCount(breakdown.count)}`,
    ),
    [KPI.COMMISSION]: card(
      block.commission,
      `${formatPercent(block.commissionPercent)}% от продаж`,
    ),
    [KPI.TAX]: card(block.tax, `${formatPercent(block.taxPercent)}% от продаж`),
    [KPI.PURCHASE]: card(block.purchase, shareOfSales(block.purchase, block.revenue)),
    [KPI.NET]: {
      value: rub(block.net),
      caption:
        breakdown.margin === null || net === undefined
          ? (net?.label ?? null)
          : `${net.label} · маржа ${formatPercent(Math.round(breakdown.margin * 1000) / 10)}%`,
      heading,
      empty: response.empty,
      emptyText: response.emptyText,
      tone: block.net < 0 ? 'danger' : 'ok',
    },
  };
}

/**
 * «Unit-экономика по площадкам» (решение crm_unit_economics_platforms): строка
 * подключённой площадки — тот же основной блок «Прибыли», что карточки ряда, и
 * та же маржа, что под «Чистой» (`profitBreakdown`), поэтому числа совпадают
 * по построению. Ответ — прибыль магазина ЯМ, поэтому числа несёт только строка
 * ЯМ: живой Ozon/WB числа ЯМ не ставятся никогда. Остальные площадки —
 * приглушённые строки без чисел; «скоро» или ссылку на свой раздел решает
 * карточка по `me.sections`, маппер от сервера не зависит.
 */
export function mapUnitEconomics(response: ProfitResponse): UnitEconomicsRow[] {
  const block = mainBlock(response);
  const { margin } = profitBreakdown(response);
  const percent = (value: number): string => `${formatPercent(value)}%`;
  const netTone = block.net < 0 ? 'danger' : 'ok';

  const active: UnitEconomicsRow[] = ALL_MARKETPLACES.filter((m) => m.key === 'ym').map((m) => ({
    key: m.key,
    label: m.label,
    active: true,
    sales: rub(block.revenue),
    commission: rub(block.commission),
    commissionShare: percent(block.commissionPercent),
    tax: rub(block.tax),
    taxShare: percent(block.taxPercent),
    purchase: rub(block.purchase),
    net: rub(block.net),
    margin: margin === null ? null : percent(Math.round(margin * 1000) / 10),
    tone: margin === null ? 'neutral' : netTone,
  }));
  const others: UnitEconomicsRow[] = ALL_MARKETPLACES.filter((m) => m.key !== 'ym').map((m) => ({
    key: m.key,
    label: m.label,
    active: false,
    sales: null,
    commission: null,
    commissionShare: null,
    tax: null,
    taxShare: null,
    purchase: null,
    net: null,
    margin: null,
    tone: 'neutral',
  }));
  return [...active, ...others];
}

/** Срез заказов: число, сумма продаж и момент съёмки — как на странице отчёта. */
export function mapOrdersKpi(response: OrdersReportResponse): KpiSummary {
  const report = mapOrdersReport(response);
  const empty = report.count === 0;
  return {
    value: formatCount(report.count),
    caption: empty ? null : `на ${formatRub(report.totals.sales)}`,
    heading: report.heading,
    empty,
    emptyText: report.emptyText,
    tone: 'neutral',
  };
}

/**
 * Остатки FBY — доступные к продаже штуки из отчёта Маркета. Денег нет: отчёт
 * остатков цен не несёт, а умножать на прайс значило бы выдумать оценку склада.
 * Отчёт не собрался — причина словами бэкенда.
 */
export function mapStockKpi(response: FbyResponse): KpiSummary {
  const report = mapFby(response);
  if (report.stock === null) {
    return {
      value: '—',
      caption: null,
      heading: null,
      empty: true,
      emptyText: report.stockProblem ?? 'Отчёт остатков пока не готов.',
      tone: 'neutral',
    };
  }
  return {
    value: `${formatCount(report.stock.totals.AVAILABLE)} шт.`,
    caption: 'доступно к продаже',
    // Момент съёмки ОСТАТКОВ, а не сводки: отчёт Маркета может быть мемо
    // минутной давности (FbyStockService), и печатать надо его время.
    heading: response.stockTakenAt ? `на ${response.stockTakenAt} МСК` : report.heading,
    empty: false,
    emptyText: '',
    tone: 'neutral',
  };
}

export type KpiSummaries = Partial<Record<KpiKey, KpiSummary>>;

/** Строка блока «Заказы» из среза заказов — число и сумма продаж страницы отчёта. */
export function mapOrdersRow(response: OrdersReportResponse): OrderRowSummary {
  const report = mapOrdersReport(response);
  return {
    count: formatCount(report.count),
    amount: report.count === 0 ? null : `на ${formatRub(report.totals.sales)}`,
    heading: report.heading,
  };
}

/**
 * «Оформлено» и «Отменено» из уже загруженной «Прибыли». Оформлено — блок
 * placed, а не основной: при пустом периоде основным становится выкупленный, а
 * строка называется «Оформлено». У отмен суммы в ответе нет — «—», не «0 ₽».
 */
export function mapProfitRows(
  response: ProfitResponse,
): Record<typeof ORDER_ROW.PLACED | typeof ORDER_ROW.CANCELLED, OrderRowSummary> {
  const heading = response.periodTitle;
  return {
    [ORDER_ROW.PLACED]: {
      count: formatCount(response.placed.orders),
      amount: response.placed.orders === 0 ? null : `на ${formatRub(response.placed.revenue)}`,
      heading,
    },
    [ORDER_ROW.CANCELLED]: { count: formatCount(response.cancelled), amount: null, heading },
  };
}

export type OrderRowSummaries = Partial<Record<OrderRowKey, OrderRowSummary>>;

/** Ключи рядов графика «Выручка и чистая прибыль». */
export const PROFIT_SERIES = { REVENUE: 'revenue', NET: 'net' } as const;

export interface ProfitSeries {
  points: AreaPoint[];
  /** Учтённые заказы без даты: в карточках есть, на графике нет. */
  undated: number;
}

/**
 * Ряд по дням из того же основного блока, что карточки «Продажи» и «Чистая»:
 * сервер копит его в profitOf одним проходом с итогом, поэтому Σ точек = числу
 * карточки по построению. Дни без заказов — нули в границах периода.
 */
export function mapProfitSeries(response: ProfitResponse): ProfitSeries {
  const block = mainBlock(response);
  const days = fillDays(
    block.byDay ?? [],
    response.days?.from ?? null,
    response.days?.to ?? null,
    (date) => ({ date, revenue: 0, net: 0 }),
  );
  return {
    points: days.map((day) => {
      const [y, m, d] = day.date.split('-');
      return {
        key: day.date,
        label: `${d}-${m}`,
        hint: `${d}-${m}-${y}`,
        values: { [PROFIT_SERIES.REVENUE]: day.revenue, [PROFIT_SERIES.NET]: day.net },
      };
    }),
    undated: block.undatedOrders ?? 0,
  };
}
