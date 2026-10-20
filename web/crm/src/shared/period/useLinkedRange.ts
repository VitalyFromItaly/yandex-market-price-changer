import type { DayRange } from '@/shared/utils';

import { useRoute, useRouter } from 'vue-router';

import { rangeFromQuery } from './range';

import { moscowToday } from '@/shared/utils';

/**
 * Применить период из ссылки «Обзора» (`?from=&to=`) и снять его из адреса —
 * близнец `useLinkedPeriod`: звать ДО первой загрузки, снимать `replace`-ом,
 * чтобы F5 после смены периода на странице не возвращал к периоду ссылки.
 */
export function useLinkedRange(
  select: (range: DayRange) => void,
  /** Ещё параметры ссылки, которые страница прочла сама и тоже снимает (площадка «Финансов»). */
  alsoStrip: readonly string[] = [],
): void {
  const route = useRoute();
  const router = useRouter();
  if (!('from' in route.query) && !('to' in route.query)) return;
  const linked = rangeFromQuery(route.query, moscowToday());
  if (linked !== null) select(linked);
  const rest = Object.fromEntries(
    Object.entries(route.query).filter(
      ([name]) => name !== 'from' && name !== 'to' && !alsoStrip.includes(name),
    ),
  );
  void router.replace({ query: rest });
}
