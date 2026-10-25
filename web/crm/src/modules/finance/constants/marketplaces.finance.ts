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

/**
 * Вкладки, которой у площадки нет (TASK-180: ДДС Ozon/WB, сверка WB, аномалии
 * не ЯМ), сервер отвечает причиной — экран показывает её вместо нулей.
 */
export interface FinanceUnsupported {
  unsupported: true;
  note: string;
}

export function isFinanceUnsupported(value: object): value is FinanceUnsupported {
  return 'unsupported' in value && value.unsupported === true;
}
