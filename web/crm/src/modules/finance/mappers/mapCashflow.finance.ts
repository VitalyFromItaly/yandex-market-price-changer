import type { Cashflow, CashflowModel } from '../finance.domain';

import { formatDay, formatKopecks } from '@/shared/utils';

/**
 * ДДС → модель экрана (переехал из «Закупок»). Суммы приходят готовыми;
 * выбытия печатаются модулем, итог — со знаком, как в отчёте о движении денег.
 */
export function toCashflowModel(cashflow: Cashflow): CashflowModel {
  const { inflow, outflow, receivable } = cashflow;
  return {
    rangeLabel: `${formatDay(cashflow.from)} — ${formatDay(cashflow.to)}`,
    inflow: [
      { key: 'payouts', label: 'Выплаты Маркета', amount: formatKopecks(inflow.payoutsKopecks) },
    ],
    inflowTotal: formatKopecks(inflow.totalKopecks),
    outflow: [
      {
        key: 'purchases',
        label: 'Оплата закупок',
        amount: formatKopecks(outflow.purchasesKopecks),
      },
      {
        key: 'expenses',
        label: 'Операционные расходы',
        amount: formatKopecks(outflow.expensesKopecks),
        children: outflow.expensesByCategory.map(({ key, label, kopecks }) => ({
          key,
          label,
          amount: formatKopecks(kopecks),
        })),
      },
      { key: 'taxes', label: 'Уплаченные налоги', amount: formatKopecks(outflow.taxesKopecks) },
    ],
    outflowTotal: formatKopecks(outflow.totalKopecks),
    net: formatKopecks(cashflow.netKopecks),
    netNegative: cashflow.netKopecks < 0,
    payouts: cashflow.payouts.map((payout, index) => ({
      key: payout.bankOrderId ?? `day-${payout.day}-${index}`,
      day: formatDay(payout.day),
      order: payout.bankOrderId ?? 'без номера',
      amount: formatKopecks(payout.kopecks),
      mismatch: payout.mismatch,
    })),
    receivable: {
      asOf: formatDay(receivable.asOf),
      total: formatKopecks(receivable.totalKopecks),
      isEmpty: receivable.byArticle.length === 0,
      byArticle: receivable.byArticle.map(({ article, label, kopecks }) => ({
        key: article,
        label,
        amount: formatKopecks(kopecks),
      })),
    },
  };
}
