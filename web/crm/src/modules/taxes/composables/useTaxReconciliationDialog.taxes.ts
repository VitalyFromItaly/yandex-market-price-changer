import type { TaxReconciliationForm, TaxYearErrors, TaxYearPeriod } from '../taxes.domain';

import { ref } from 'vue';

import {
  mapTaxYearError,
  reconciliationBody,
  toReconciliationForm,
} from '../mappers/mapTaxYear.taxes';
import { useTaxesStore } from '../store/store.taxes';

import { toast } from '@/components/ui/toast';

/** Диалог сверки отчётного периода с бухгалтерией: суммы бухгалтера и отметка «сверено». */
export function useTaxReconciliationDialog() {
  const store = useTaxesStore();

  const open = ref(false);
  const period = ref<TaxYearPeriod | null>(null);
  const form = ref<TaxReconciliationForm>({
    accountantIncome: '',
    accountantTax: '',
    checked: false,
    note: '',
  });
  const errors = ref<TaxYearErrors>({});
  const busy = ref(false);

  function show(target: TaxYearPeriod): void {
    period.value = target;
    form.value = toReconciliationForm(target);
    errors.value = {};
    open.value = true;
  }

  async function save(): Promise<void> {
    const target = period.value;
    if (target === null) return;
    busy.value = true;
    errors.value = {};
    try {
      await store.reconcile(target.key, reconciliationBody(form.value));
      open.value = false;
      toast.success('Сохранено', `Сверка: ${target.label}`);
    } catch (e) {
      errors.value = mapTaxYearError(e, 'Не удалось сохранить сверку');
    } finally {
      busy.value = false;
    }
  }

  return { open, period, form, errors, busy, show, save };
}
