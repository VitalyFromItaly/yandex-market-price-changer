import type { CalcRequest, CalcView } from '../mappers/mapCalc.price-calculator';
import type { CalcRates, CalcSkuResponse } from '../price-calculator.domain';

import { defineStore } from 'pinia';
import { computed, watch } from 'vue';

import {
  baseRates,
  calculate,
  withOverrides,
  withTariff,
} from '../mappers/mapCalc.price-calculator';

import { useCalcForm } from './composables/useCalcForm.price-calculator';
import { useCalcOverrides } from './composables/useCalcOverrides.price-calculator';
import { useCalcRates } from './composables/useCalcRates.price-calculator';
import { useTariffQuote } from './composables/useTariffQuote.price-calculator';

/**
 * Стор «Калькулятора цен» — фасад: ставки из журнала, форма, правки руками и
 * сверка с тарифом. Итоговые ставки — слои по старшинству: факт → тариф ЯМ →
 * введено; у каждой видно, откуда она. Расчёт — computed по общей формуле.
 */
export const usePriceCalculatorStore = defineStore('price-calculator', () => {
  const rates = useCalcRates();
  const form = useCalcForm();
  const overrides = useCalcOverrides();
  const tariff = useTariffQuote();

  const selected = computed<CalcSkuResponse | null>(
    () => rates.data.value?.skus.find((s) => s.sku === form.sku.value) ?? null,
  );

  /** Тариф — только того товара, что выбран сейчас. */
  const applicableTariff = computed(() => {
    const quote = tariff.tariff.value;
    return quote && quote.sku === form.sku.value ? quote : null;
  });

  const effective = computed<CalcRates | null>(() => {
    const data = rates.data.value;
    if (!data) return null;
    const base = baseRates(data, selected.value);
    return withOverrides(withTariff(base, applicableTariff.value), overrides.overrides.value);
  });

  const view = computed<CalcView | null>(() => {
    const data = rates.data.value;
    if (!data || !effective.value) return null;
    const request: CalcRequest = {
      mode: form.mode.value,
      priceKopecks: form.priceKopecks.value,
      targetKind: form.targetKind.value,
      target: form.target.value,
      discountRate: form.discountRate.value,
      taxMode: data.tax.mode,
      taxMinRate: data.tax.minRate,
    };
    return calculate(effective.value, request);
  });

  // Другой товар — другие ставки: правки прежнего к нему не относятся.
  watch(form.sku, () => overrides.reset());

  function chooseSku(sku: string | null): void {
    form.setSku(sku);
    const price = rates.data.value?.skus.find((s) => s.sku === sku)?.avgPriceKopecks ?? null;
    // Стартовая цена — средняя цена продажи товара за окно; правится руками.
    if (price !== null) form.setPriceText(String(Math.round(price) / 100).replace('.', ','));
  }

  function checkTariff(): void {
    const sku = form.sku.value;
    const price =
      form.mode.value === 'price' && view.value?.state === 'ok'
        ? view.value.result.priceKopecks
        : form.priceKopecks.value;
    if (sku && price) tariff.request(sku, price);
  }

  return {
    ...form,
    data: rates.data,
    isLoading: rates.isLoading,
    isRefreshing: rates.isRefreshing,
    savedAt: rates.savedAt,
    error: rates.error,
    ensure: rates.ensure,
    refresh: rates.refresh,
    retry: rates.retry,
    selected,
    effective,
    view,
    overrides: overrides.overrides,
    setOverride: overrides.set,
    clearOverride: overrides.clear,
    tariffStore: tariff.store,
    setTariffStore: tariff.setStore,
    tariff: applicableTariff,
    tariffLoading: tariff.isLoading,
    tariffError: tariff.error,
    chooseSku,
    checkTariff,
    reset() {
      rates.reset();
      form.reset();
      overrides.reset();
      tariff.reset();
    },
  };
});
