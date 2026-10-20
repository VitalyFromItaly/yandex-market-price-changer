import type { TaxReduction, TaxReductionForm, TaxYearErrors } from '../taxes.domain';

import { computed, ref } from 'vue';

import { mapTaxYearError, reductionBody, toReductionForm } from '../mappers/mapTaxYear.taxes';
import { useTaxesStore } from '../store/store.taxes';

import { toast } from '@/components/ui/toast';
import { moscowToday } from '@/shared/utils';

/** Диалог уменьшения налога: дата, вид, сумма, комментарий; и удаление с подтверждением. */
export function useTaxReductionDialog(today: () => string = () => moscowToday()) {
  const store = useTaxesStore();

  const open = ref(false);
  const editing = ref<TaxReduction | null>(null);
  const form = ref<TaxReductionForm>(toReductionForm(null, today()));
  const errors = ref<TaxYearErrors>({});
  const busy = ref(false);

  const removeOpen = ref(false);
  const removing = ref<TaxReduction | null>(null);

  const title = computed(() =>
    editing.value === null ? 'Уменьшение налога' : 'Изменить уменьшение',
  );

  function show(reduction: TaxReduction | null): void {
    editing.value = reduction;
    form.value = toReductionForm(reduction, today());
    errors.value = {};
    open.value = true;
  }

  async function save(): Promise<void> {
    busy.value = true;
    errors.value = {};
    try {
      await store.saveReduction(editing.value?.id ?? null, reductionBody(form.value));
      open.value = false;
      toast.success('Сохранено', 'Уменьшение записано, год пересчитывается');
    } catch (e) {
      errors.value = mapTaxYearError(e, 'Не удалось сохранить уменьшение');
    } finally {
      busy.value = false;
    }
  }

  function askRemove(reduction: TaxReduction): void {
    removing.value = reduction;
    removeOpen.value = true;
  }

  async function confirmRemove(): Promise<void> {
    const target = removing.value;
    if (target === null) return;
    busy.value = true;
    try {
      await store.removeReduction(target.id);
      removeOpen.value = false;
      toast.success('Удалено', target.kindLabel);
    } catch (e) {
      toast.error('Не удалось удалить', e instanceof Error ? e.message : undefined);
    } finally {
      busy.value = false;
    }
  }

  return {
    open,
    editing,
    form,
    errors,
    busy,
    title,
    removeOpen,
    removing,
    openCreate: () => show(null),
    openEdit: (reduction: TaxReduction) => show(reduction),
    save,
    askRemove,
    confirmRemove,
  };
}
