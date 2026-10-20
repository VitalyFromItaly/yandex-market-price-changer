import type { CalcRateKey } from '../../price-calculator.domain';

import { parseRateInput } from '../../mappers/mapCalc.price-calculator';

import { useBaseState } from '@/shared/composables';

/**
 * Ставки, введённые руками, — поверх факта и тарифа с меткой «введено».
 * Пустое поле снимает правку («вернуть факт»), мусор правку не ставит.
 */
export function useCalcOverrides() {
  const [overrides, setOverrides, , resetOverrides] = useBaseState<
    Partial<Record<CalcRateKey, number>>
  >({});

  function set(key: CalcRateKey, text: string): void {
    const value = parseRateInput(key, text);
    const next = { ...overrides.value };
    if (value === null) delete next[key];
    else next[key] = value;
    setOverrides(next);
  }

  function clear(key: CalcRateKey): void {
    const next = { ...overrides.value };
    delete next[key];
    setOverrides(next);
  }

  return { overrides, set, clear, reset: resetOverrides };
}
