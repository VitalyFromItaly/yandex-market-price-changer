import type { FinanceTabMeta } from '../finance.domain';

/** Аномалии журнала (TASK-149) — вкладка под своей фичей поверх `finance`. */
export const FINANCE_ANOMALIES_FEATURE = 'finance_anomalies';

/** Ручная загрузка отчёта (TASK-114) — вкладка под своей фичей поверх `finance`. */
export const FINANCE_UPLOAD_FEATURE = 'finance_upload';

export const FINANCE_TABS: readonly FinanceTabMeta[] = [
  { key: 'pnl', label: 'Прибыль' },
  { key: 'cashflow', label: 'ДДС' },
  { key: 'audit', label: 'Сверка' },
  { key: 'anomalies', label: 'Аномалии', feature: FINANCE_ANOMALIES_FEATURE },
  { key: 'upload', label: 'Загрузка', feature: FINANCE_UPLOAD_FEATURE },
];
