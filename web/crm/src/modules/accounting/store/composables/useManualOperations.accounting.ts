import type { ManualOperationBody, ManualOperationsView } from '../../accounting.domain';

import { ref } from 'vue';

import { accountingApi } from '../../api/accountingApi.accounting';

import { useBaseState } from '@/shared/composables';

/**
 * Ручные операции «Финучёта» (TASK-208): загрузка и записи. Каждая запись
 * заменяет вид ответом сервера. Ошибки записей пробрасываются: под какое поле
 * их ставить, решает форма.
 */
export function useManualOperations() {
  const [manual, setManual, manualLoading, resetManual, hasManual] =
    useBaseState<ManualOperationsView | null>(null);
  const manualError = ref<string | null>(null);

  async function loadManual(): Promise<void> {
    manualLoading.value = true;
    manualError.value = null;
    try {
      setManual(await accountingApi.manual());
    } catch (e) {
      manualError.value = e instanceof Error ? e.message : 'Не удалось загрузить ручные операции';
    } finally {
      manualLoading.value = false;
    }
  }

  async function apply(request: Promise<ManualOperationsView>): Promise<void> {
    setManual(await request);
  }

  const createManual = (body: ManualOperationBody) => apply(accountingApi.createManual(body));
  const updateManual = (id: string, body: ManualOperationBody) =>
    apply(accountingApi.updateManual(id, body));
  const removeManual = (id: string) => apply(accountingApi.removeManual(id));

  function reset(): void {
    resetManual();
    manualError.value = null;
  }

  return {
    manual,
    manualLoading,
    hasManual,
    manualError,
    loadManual,
    createManual,
    updateManual,
    removeManual,
    reset,
  };
}
