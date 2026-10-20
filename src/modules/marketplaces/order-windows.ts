import type { IPeriodBounds, IReportPeriod } from '../yandex/reports/report-period';

import { calendarDayBounds, moscowDay, shiftDays } from '../yandex/reports/moscow-day';
import { isUnbounded, MAX_WINDOW_DAYS, periodWindows } from '../yandex/reports/report-period';

/**
 * Окна периода для заказов площадок — общие у Ozon (TASK-130) и WB (TASK-135):
 * те же `periodWindows` по 30 дней, что заказы ЯМ. «Всего» — последние 30
 * московских дней по сегодня, как неявное окно ЯМ.
 */
export function marketplaceOrderWindows(
  period: IReportPeriod,
  now: Date = new Date(),
): IPeriodBounds[] {
  if (!isUnbounded(period)) return periodWindows(period, now);
  const today = moscowDay(now);
  return [{ from: shiftDays(today, -(MAX_WINDOW_DAYS - 1)), to: today }];
}

/** Границы окна моментами: с 00:00:00 первого дня по 23:59:59 последнего, по Москве. */
export function windowMoments(
  window: IPeriodBounds,
  now: Date = new Date(),
): { since: Date; to: Date } {
  return {
    since: new Date(calendarDayBounds(window.from, now).from),
    to: new Date(calendarDayBounds(window.to, now).to),
  };
}
