import type { ReportPeriod } from './period';

import { useRoute, useRouter } from 'vue-router';

import { periodFromQuery } from './period';

/**
 * Применить период из ссылки (главная → отчёт) и снять его из адреса.
 *
 * Звать ДО watch с immediate, который собирает отчёт: иначе первая задача уйдёт
 * с прежним периодом стора. Query снимается `replace`-ом — после смены периода
 * на странице F5 не должен возвращать к периоду главной.
 */
export function useLinkedPeriod(select: (period: ReportPeriod) => void): void {
  const route = useRoute();
  const router = useRouter();
  const linked = periodFromQuery(route.query);
  if (!('period' in route.query) && !('day' in route.query)) return;
  if (linked !== null) select(linked);
  const rest = Object.fromEntries(
    Object.entries(route.query).filter(([name]) => name !== 'period' && name !== 'day'),
  );
  void router.replace({ query: rest });
}
