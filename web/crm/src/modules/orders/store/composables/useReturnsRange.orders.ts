import type { RangePreset } from '@/shared/period';
import type { DayRange } from '@/shared/utils';

import { computed } from 'vue';

import { useBaseState } from '@/shared/composables';
import { isValidRange, rangeOf } from '@/shared/period';
import { moscowToday } from '@/shared/utils';

/**
 * Период «Едет обратно» — как фильтр «Период» кабинета ЯМ: пресет или свои даты.
 * По умолчанию «30 дней» — ближе всего к «последнему месяцу» кабинета. Запрос — только
 * у пригодного периода (`isValidRange`: не задом наперёд, не будущее, не длиннее года).
 */
export function useReturnsRange() {
  const [preset, setPreset, , resetPreset] = useBaseState<RangePreset>('30d');
  const [custom, setCustom, , resetCustom] = useBaseState<DayRange | null>(null);

  const range = computed<DayRange | null>(() => {
    const today = moscowToday();
    const next = preset.value === 'custom' ? custom.value : rangeOf(preset.value, today);
    return next && isValidRange(next, today) ? next : null;
  });

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

  return { preset, custom, range, choosePreset, chooseCustom, reset };
}
