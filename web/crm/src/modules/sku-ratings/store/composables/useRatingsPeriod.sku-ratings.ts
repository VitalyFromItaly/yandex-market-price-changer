import type { RatingsRequest } from '../../sku-ratings.domain';
import type { RangePreset } from '@/shared/period';
import type { DayRange } from '@/shared/utils';

import { computed } from 'vue';

import { useBaseState } from '@/shared/composables';
import { isValidRange, previousRange, rangeOf } from '@/shared/period';
import { moscowToday } from '@/shared/utils';

/**
 * Период рейтингов: пресет или свои даты, прошлый — `previousRange`. По
 * умолчанию «30 дней»: XYZ считается по полным неделям, и «этот месяц» в его
 * начале давал бы «нужен период от 4 недель» вместо классов.
 */
export function useRatingsPeriod() {
  const [preset, setPreset, , resetPreset] = useBaseState<RangePreset>('30d');
  const [custom, setCustom, , resetCustom] = useBaseState<DayRange | null>(null);

  const range = computed<DayRange | null>(() => {
    const today = moscowToday();
    const next = preset.value === 'custom' ? custom.value : rangeOf(preset.value, today);
    return next && isValidRange(next, today) ? next : null;
  });

  const request = computed<RatingsRequest | null>(() =>
    range.value ? { range: range.value, previous: previousRange(range.value) } : null,
  );

  function choosePreset(next: RangePreset): void {
    setPreset(next);
    if (next === 'custom' && custom.value === null) setCustom(rangeOf('30d', moscowToday()));
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
