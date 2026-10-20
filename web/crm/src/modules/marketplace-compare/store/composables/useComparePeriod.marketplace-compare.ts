import type { CompareRequest } from '../../marketplace-compare.domain';
import type { RangePreset } from '@/shared/period';
import type { DayRange } from '@/shared/utils';

import { computed } from 'vue';

import { useBaseState } from '@/shared/composables';
import { isValidRange, previousRange, rangeOf } from '@/shared/period';
import { moscowToday } from '@/shared/utils';

/**
 * Период «Сравнения площадок»: пресет или свои даты, прошлый период —
 * `previousRange`, как у «Аналитики продаж». Запрос — только у
 * пригодного периода: по полупустой форме задача не ставится. По умолчанию —
 * прошлый месяц: он закрыт, и сравнение не плывёт от дня к дню.
 */
export function useComparePeriod() {
  const [preset, setPreset, , resetPreset] = useBaseState<RangePreset>('prevmonth');
  const [custom, setCustom, , resetCustom] = useBaseState<DayRange | null>(null);

  const range = computed<DayRange | null>(() => {
    const today = moscowToday();
    const next = preset.value === 'custom' ? custom.value : rangeOf(preset.value, today);
    return next && isValidRange(next, today) ? next : null;
  });

  const request = computed<CompareRequest | null>(() =>
    range.value ? { range: range.value, previous: previousRange(range.value) } : null,
  );

  function choosePreset(next: RangePreset): void {
    setPreset(next);
    if (next === 'custom' && custom.value === null) setCustom(rangeOf('month', moscowToday()));
  }

  function chooseCustom(next: DayRange): void {
    setCustom(next);
    setPreset('custom');
  }

  function reset(): void {
    resetPreset();
    resetCustom();
  }

  return { preset, custom, range, request, choosePreset, chooseCustom, reset };
}
