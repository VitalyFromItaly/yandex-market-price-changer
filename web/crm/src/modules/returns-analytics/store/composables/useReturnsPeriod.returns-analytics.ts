import type { RangePreset } from '@/shared/period';
import type { DayRange } from '@/shared/utils';

import { computed } from 'vue';

import { useBaseState } from '@/shared/composables';
import { isValidRange, rangeOf } from '@/shared/period';
import { moscowToday } from '@/shared/utils';

/**
 * Период «Аналитики возвратов»: пресет или свои даты. Сравнения с прошлым
 * периодом нет — его нет в ТЗ. Диапазон — только пригодный: по полупустой форме
 * задача не ставится.
 */
export function useReturnsPeriod() {
  const [preset, setPreset, , resetPreset] = useBaseState<RangePreset>('month');
  const [custom, setCustom, , resetCustom] = useBaseState<DayRange | null>(null);

  const range = computed<DayRange | null>(() => {
    const today = moscowToday();
    const next = preset.value === 'custom' ? custom.value : rangeOf(preset.value, today);
    return next && isValidRange(next, today) ? next : null;
  });

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

  return { preset, custom, range, choosePreset, chooseCustom, reset };
}
