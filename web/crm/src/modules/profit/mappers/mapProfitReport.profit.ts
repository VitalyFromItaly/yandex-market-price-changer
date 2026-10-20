import type {
  ActualNet,
  Breakdown,
  BreakdownRow,
  ExcludedResponse,
  ProfitActualResponse,
  ProfitBlockResponse,
  ProfitReport,
  ProfitReportResponse,
  ProfitResponse,
  ProfitScreen,
  TariffReport,
  TariffResponse,
} from '../profit.domain';

import { UNCONFIRMED_PROFIT_LABEL } from '../../../../../../src/shared/profit-confirmation';
import { PROFIT_REPORT } from '../profit.domain';

import { formatCount, formatRub } from '@/shared/utils';

/** Процент без лишнего «.0»: «23», но «23.5» — как у бота. */
export function formatPercent(value: number): string {
  return String(Number(value.toFixed(2)));
}

function row(
  label: string,
  value: number,
  kind: BreakdownRow['kind'],
  hint: string | null = null,
): BreakdownRow {
  return { label, value, kind, hint, negative: kind === 'total' && value < 0 };
}

const SUBSIDIES = 'в т.ч. субсидии Маркета';

function marginOf(block: ProfitBlockResponse): number | null {
  return block.revenue ? block.net / block.revenue : null;
}

/**
 * Продажи и первая строка. Субсидии — пояснением и только ненулевые: «0 ₽»
 * ничего не сообщает (правило бота).
 */
function salesRow(block: ProfitBlockResponse): BreakdownRow {
  return row(
    'Продажи',
    block.revenue,
    'plus',
    block.subsidies ? `${SUBSIDIES}: ${formatRub(block.subsidies)}` : null,
  );
}

/** Хвост столбца: налог, продвижение (только начисленное), закуп, чистая. */
function tailRows(block: ProfitBlockResponse, net: BreakdownRow): BreakdownRow[] {
  return [
    row(`Налог ${formatPercent(block.taxPercent)}%`, block.tax, 'minus'),
    ...(block.promo ? [row('Продвижение', block.promo, 'minus')] : []),
    row('Закуп', block.purchase, 'minus'),
    net,
  ];
}

/**
 * Основной блок отчёта — оформленные, а без них выкупленные (решение бэкенда,
 * `main`). Экспортирован для главной: её денежные карточки обязаны читать тот
 * же блок, что столбец «Прибыли», куда они ведут.
 */
export function mainBlock(response: ProfitResponse): ProfitBlockResponse {
  return response.main === 'placed' ? response.placed : response.redeemed;
}

/**
 * Итог столбца. Непроверенный журнал — пометка на самой сумме и причина
 * пояснением (как « · предварительно» у бота); проверенный — плоская как есть.
 */
function netRow(
  block: ProfitBlockResponse,
  label: string,
  actual: ProfitActualResponse | null,
): BreakdownRow {
  const total = row(label, block.net, 'total');
  if (!actual || actual.state === 'verified') return total;
  return { ...total, label: `${label} · ${actual.mark}`, hint: actual.reason };
}

function actualNetOf(actual: ProfitActualResponse | null): ActualNet | null {
  return actual?.state === 'verified'
    ? {
        label: actual.label,
        value: actual.net,
        note: actual.scopeNote,
        unconfirmed: actual.unconfirmed,
      }
    : null;
}

export function profitBreakdown(response: ProfitResponse): Breakdown {
  const placed = response.main === 'placed';
  const block = mainBlock(response);
  const estimate = response.estimate;
  const actual = response.actual ?? null;
  return {
    countLabel: placed ? 'Оформлено' : 'Заказов',
    count: block.orders,
    rows: [
      salesRow(block),
      row(`Комиссия ${formatPercent(block.commissionPercent)}%`, block.commission, 'minus'),
      ...(estimate
        ? [row('По калькулятору Маркета', estimate.servicesTotal, 'info', estimate.share)]
        : []),
      ...tailRows(block, netRow(block, placed ? 'Ожидается чистая' : 'Чистая', actual)),
    ],
    note: placed ? response.notes.placed : null,
    margin: marginOf(block),
    actual: actualNetOf(actual),
  };
}

function returnedLine(returned: { orders: number; revenue: number }): string[] {
  return returned.orders
    ? [
        `Возвраты: ${formatCount(returned.orders)} на ${formatRub(returned.revenue)} — ` +
          'исключены из расчёта целиком.',
      ]
    : [];
}

function excludedOf(excluded: ExcludedResponse, advice: string | null) {
  return !excluded.confirmed
    ? {
        label: UNCONFIRMED_PROFIT_LABEL,
        orders: excluded.orders,
        revenue: excluded.revenueKopecks / 100,
        reason: excluded.reason,
        skus: excluded.skus,
        advice,
      }
    : null;
}

export function mapProfit(response: ProfitResponse): ProfitReport {
  const lines: string[] = [];
  if (response.cancelled) {
    lines.push(`Отменено: ${formatCount(response.cancelled)} — в расчёт не входят.`);
  }
  // Выкупленное одной строкой — только когда основной блок у оформленных.
  if (response.main === 'placed' && response.redeemed.orders) {
    lines.push(
      `Выкуплено: ${formatCount(response.redeemed.orders)} на ` +
        `${formatRub(response.redeemed.revenue)} → чистая ${formatRub(response.redeemed.net)}`,
      response.notes.otherOrders,
    );
  }
  lines.push(...returnedLine(response.returned));

  const footer = [response.prices.text];
  if (response.promo.length) footer.push(`Продвижение: ${response.promo.join(', ')}.`);

  return {
    key: PROFIT_REPORT.PROFIT,
    period: response.period,
    heading: response.periodTitle,
    empty: response.empty,
    emptyText: response.emptyText,
    breakdown: profitBreakdown(response),
    lines,
    excluded: excludedOf(response.excluded, response.notes.unknownSkus),
    footer,
  };
}

export function mapTariff(response: TariffResponse): TariffReport {
  const block = response.block;
  const breakdown: Breakdown | null = block.orders
    ? {
        countLabel: 'Оформлено',
        count: block.orders,
        rows: [
          salesRow(block),
          row('Услуги Маркета', block.commission, 'minus', response.servicesShare),
          ...tailRows(block, row('Ожидается чистая', block.net, 'total')),
        ],
        note: response.notes.placed,
        margin: marginOf(block),
        actual: null,
      }
    : null;

  return {
    key: PROFIT_REPORT.TARIFF,
    period: response.period,
    heading: response.periodTitle,
    empty: response.empty,
    emptyText: response.emptyText,
    breakdown,
    services: block.orders ? response.services : [],
    lines: [
      // Сравнение со ставкой — сразу под расчётом, как у бота: без него две
      // чистые на двух вкладках читаются как ошибка одной из них.
      block.orders
        ? response.comparison.text
        : `Оформлено: ${formatCount(response.totalOrders)}. ${response.notes.nothingCounted}`,
      ...returnedLine(response.returned),
    ],
    // У калькулятора причин две (прайс или каталог) — совет «пришлите прайс»
    // был бы полуправдой, причина названа в самом блоке.
    excluded: excludedOf(response.excluded, null),
    footer: [response.prices.text, response.notes.approx],
  };
}

export function mapProfitScreen(response: ProfitReportResponse): ProfitScreen {
  return response.key === PROFIT_REPORT.TARIFF ? mapTariff(response) : mapProfit(response);
}
