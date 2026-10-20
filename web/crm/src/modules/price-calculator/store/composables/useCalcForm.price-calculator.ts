import type { CalcMode, TargetKind } from '../../price-calculator.domain';

import { computed } from 'vue';

import { parseNumber } from '../../mappers/mapCalc.price-calculator';

import { useBaseState } from '@/shared/composables';

/**
 * Форма: товар, цена, скидка и цель. Поля хранятся строками ввода — числа
 * разбираются computed-ами, чтобы недописанное «12,» не стирало поле.
 */
export function useCalcForm() {
  const [sku, setSku, , resetSku] = useBaseState<string | null>(null);
  const [mode, setMode, , resetMode] = useBaseState<CalcMode>('profit');
  const [priceText, setPriceText, , resetPrice] = useBaseState('');
  const [discountText, setDiscountText, , resetDiscount] = useBaseState('');
  const [targetKind, setTargetKind, , resetTargetKind] = useBaseState<TargetKind>('percent');
  const [targetText, setTargetText, , resetTarget] = useBaseState('');

  const priceKopecks = computed(() => {
    const value = parseNumber(priceText.value);
    return value === null || value < 0 ? null : Math.round(value * 100);
  });

  /** Скидка в процентах → доля; пусто — без скидки. */
  const discountRate = computed(() => {
    const value = parseNumber(discountText.value);
    return value === null || value < 0 ? 0 : value / 100;
  });

  const target = computed(() => {
    const value = parseNumber(targetText.value);
    if (value === null) return null;
    return targetKind.value === 'rub' ? Math.round(value * 100) : value / 100;
  });

  function reset(): void {
    resetSku();
    resetMode();
    resetPrice();
    resetDiscount();
    resetTargetKind();
    resetTarget();
  }

  return {
    sku,
    mode,
    priceText,
    discountText,
    targetKind,
    targetText,
    priceKopecks,
    discountRate,
    target,
    setSku,
    setMode,
    setPriceText,
    setDiscountText,
    setTargetKind,
    setTargetText,
    reset,
  };
}
