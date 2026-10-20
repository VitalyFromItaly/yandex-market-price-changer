import type { TaxErrors, TaxForm, TaxRegime } from '../taxes.domain';

import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';

import { isSameForm, mapTaxError, taxBody, toTaxForm, withRegime } from '../mappers/mapTaxes.taxes';
import { useTaxesStore } from '../store/store.taxes';

import { toast } from '@/components/ui/toast';

/**
 * Форма налоговых настроек: черновик поверх сохранённого, одна кнопка
 * «Сохранить». После ответа форма пересобирается из записанного. Смена режима
 * подставляет его общую ставку, если ставку не трогали.
 */
export function useTaxForm() {
  const store = useTaxesStore();
  const { view } = storeToRefs(store);

  const form = ref<TaxForm | null>(null);
  const errors = ref<TaxErrors>({});
  const busy = ref(false);

  watch(
    view,
    (next) => {
      form.value = next === null ? null : toTaxForm(next);
    },
    { immediate: true },
  );

  /** Умолчание ещё не сохранено — сохранить его тоже осмысленно. */
  const dirty = computed(
    () =>
      view.value !== null &&
      form.value !== null &&
      (view.value.isDefault || !isSameForm(form.value, toTaxForm(view.value))),
  );

  function chooseRegime(regime: TaxRegime): void {
    if (view.value === null || form.value === null) return;
    form.value = withRegime(view.value, form.value, regime);
    errors.value = {};
  }

  async function submit(): Promise<void> {
    if (form.value === null || !dirty.value) return;
    busy.value = true;
    errors.value = {};
    try {
      await store.save(taxBody(form.value));
      toast.success('Сохранено', 'Налог в финансовом отчёте посчитается по этим настройкам.');
    } catch (e) {
      errors.value = mapTaxError(e, 'Не удалось сохранить налоговые настройки');
    } finally {
      busy.value = false;
    }
  }

  function discard(): void {
    if (view.value !== null) form.value = toTaxForm(view.value);
    errors.value = {};
  }

  return { form, errors, busy, dirty, chooseRegime, submit, discard };
}
