import type { AccountingLotsResponse } from '../../accounting.domain';

import { ref } from 'vue';

import { accountingApi } from '../../api/accountingApi.accounting';

import { useBaseState } from '@/shared/composables';

/**
 * Партии с остатками «Финучёта» (TASK-216). Остаток считает сервер тем же FIFO,
 * что себестоимость режима Б; здесь — только ответ. Запоздавший ответ прежнего
 * запроса новый не затирает.
 */
export function useLots() {
  const [lots, setLots, lotsLoading, resetLots, hasLots] =
    useBaseState<AccountingLotsResponse | null>(null);
  const lotsError = ref<string | null>(null);
  let latest = 0;

  async function loadLots(): Promise<void> {
    const request = ++latest;
    lotsLoading.value = true;
    lotsError.value = null;
    try {
      const response = await accountingApi.lots();
      if (request === latest) setLots(response);
    } catch (e) {
      if (request === latest) {
        lotsError.value = e instanceof Error ? e.message : 'Не удалось загрузить партии';
      }
    } finally {
      if (request === latest) lotsLoading.value = false;
    }
  }

  function reset(): void {
    resetLots();
    lotsError.value = null;
    latest += 1;
  }

  return { lots, lotsLoading, hasLots, lotsError, loadLots, reset };
}
