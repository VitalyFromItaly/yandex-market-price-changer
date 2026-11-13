import type { AccountingMarketplace, ReconcileResponse } from '../../accounting.domain';

import { ref } from 'vue';

import { accountingApi } from '../../api/accountingApi.accounting';

import { useBaseState } from '@/shared/composables';

/**
 * Сверка v2 «Финучёта» (TASK-228, площадки — TASK-227): ответ сервера за
 * выбранный месяц и площадку. Ответ запоздавшего запроса прежнего месяца или
 * площадки не затирает новый — берётся последний. Площадка null — сервер берёт
 * первую доступную.
 */
export function useReconcile() {
  const [reconcile, setReconcile, reconcileLoading, resetReconcile, hasReconcile] =
    useBaseState<ReconcileResponse | null>(null);
  const reconcileError = ref<string | null>(null);
  const reconcileMonth = ref<string | null>(null);
  const reconcileMarketplace = ref<AccountingMarketplace | null>(null);
  let latest = 0;

  async function loadReconcile(
    month: string,
    marketplace: AccountingMarketplace | null = reconcileMarketplace.value,
  ): Promise<void> {
    const request = ++latest;
    reconcileMonth.value = month;
    reconcileMarketplace.value = marketplace;
    reconcileLoading.value = true;
    reconcileError.value = null;
    try {
      const response = await accountingApi.reconcile(month, marketplace);
      if (request === latest) setReconcile(response);
    } catch (e) {
      if (request === latest) {
        reconcileError.value = e instanceof Error ? e.message : 'Не удалось загрузить сверку';
      }
    } finally {
      if (request === latest) reconcileLoading.value = false;
    }
  }

  function reset(): void {
    resetReconcile();
    reconcileError.value = null;
    reconcileMonth.value = null;
    reconcileMarketplace.value = null;
    latest += 1;
  }

  return {
    reconcile,
    reconcileLoading,
    hasReconcile,
    reconcileError,
    reconcileMonth,
    reconcileMarketplace,
    loadReconcile,
    reset,
  };
}
