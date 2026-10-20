/** Площадка «Прибыли» (TASK-137): ячейка «Сравнения площадок» открывает её журнал. */

export type FinanceMarketplace = 'ym' | 'ozon' | 'wb';

export const FINANCE_MARKETPLACE_OPTIONS: readonly { value: FinanceMarketplace; label: string }[] =
  [
    { value: 'ym', label: 'Яндекс Маркет' },
    { value: 'ozon', label: 'Ozon' },
    { value: 'wb', label: 'Wildberries' },
  ];

/** Площадка из адреса: только из списка, иначе null — ЯМ по умолчанию. */
export function parseFinanceMarketplace(value: unknown): FinanceMarketplace | null {
  return FINANCE_MARKETPLACE_OPTIONS.some((option) => option.value === value)
    ? (value as FinanceMarketplace)
    : null;
}
