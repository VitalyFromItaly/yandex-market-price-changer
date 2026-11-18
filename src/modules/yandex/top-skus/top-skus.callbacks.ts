import type { TPeriodKey } from '../reports/report-period';

/**
 * Кнопки периода «🏆 Топа товаров» (`top:<period>`). Отдельным модулем без зависимостей:
 * его читает `requiredFeatures` (features.domain), а доменный модуль экрана тянет
 * форматтеры прибыли — импорт оттуда дал бы цикл.
 */
export const TOP_CB_PATTERN = /^top:(today|week|month|prevmonth|range)$/;

export function topCallback(period: TPeriodKey): string {
  return `top:${period}`;
}

export function parseTopCallback(data: string | undefined): TPeriodKey | null {
  const match = TOP_CB_PATTERN.exec(data ?? '');
  return match ? (match[1] as TPeriodKey) : null;
}
