import type { CostCorrectionErrors, CostCorrectionForm, CostRecord } from '../accounting.domain';

import { ref } from 'vue';

import {
  correctionBody,
  mapCostCorrectionError,
  toCorrectionForm,
} from '../mappers/mapCostHistory.accounting';
import { useAccountingStore } from '../store/store.accounting';

import { toast } from '@/components/ui/toast';

/**
 * Диалог «Исправить прошлую цену» (TASK-235): из строки записи — её момент и закуп,
 * из кнопки над таблицей — пустой закуп на текущую минуту. Проверяет сервер,
 * ошибка встаёт под своё поле; диалог закрывается только после удачной записи.
 */
export function useCostCorrectionDialog(now: () => Date = () => new Date()) {
  const store = useAccountingStore();

  const open = ref(false);
  const form = ref<CostCorrectionForm>(toCorrectionForm(null, now()));
  const errors = ref<CostCorrectionErrors>({});
  const busy = ref(false);

  function openFor(record: CostRecord | null): void {
    form.value = toCorrectionForm(record, now());
    errors.value = {};
    open.value = true;
  }

  async function save(): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    errors.value = {};
    try {
      await store.correctCost(correctionBody(form.value));
      open.value = false;
      toast.success('Сохранено', 'Цена исправлена, правка — в журнале');
    } catch (e) {
      errors.value = mapCostCorrectionError(e, 'Не удалось исправить цену');
    } finally {
      busy.value = false;
    }
  }

  return { open, form, errors, busy, openFor, save };
}
