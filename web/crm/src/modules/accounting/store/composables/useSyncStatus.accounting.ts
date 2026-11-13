import type { SyncResponse } from '../../accounting.domain';

import { ref } from 'vue';

import { accountingApi } from '../../api/accountingApi.accounting';

import { useBaseState } from '@/shared/composables';

/** Журнал синхронизации «Финучёта» (TASK-212): загрузка ответа сервера, ошибка — текстом. */
export function useSyncStatus() {
  const [sync, setSync, isLoading, resetSync, hasSync] = useBaseState<SyncResponse | null>(null);
  const error = ref<string | null>(null);

  async function load(): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      setSync(await accountingApi.sync());
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Не удалось загрузить состояние загрузки';
    } finally {
      isLoading.value = false;
    }
  }

  function reset(): void {
    resetSync();
    error.value = null;
  }

  return { sync, isLoading, hasSync, error, load, reset };
}
