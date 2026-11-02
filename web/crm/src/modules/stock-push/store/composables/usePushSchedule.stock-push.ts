import type { PushInterval, PushSchedule } from '../../stock-push.domain';

import { ref } from 'vue';

import { stockPushApi } from '../../api/stockPushApi.stock-push';

import { useBaseState } from '@/shared/composables';

/**
 * Синхронизация остатков: загрузка и смена частоты. Запись заменяет состояние
 * ответом сервера — на экране то, что действительно сохранено; ошибка записи —
 * текстом под выбором, прежняя частота остаётся.
 */
export function usePushSchedule() {
  const [schedule, setSchedule, isLoading, resetSchedule, hasSchedule] =
    useBaseState<PushSchedule | null>(null);
  const error = ref<string | null>(null);
  const saveError = ref<string | null>(null);
  const isSaving = ref(false);

  async function load(): Promise<void> {
    if (isLoading.value) return;
    isLoading.value = true;
    error.value = null;
    try {
      setSchedule(await stockPushApi.getSchedule());
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Не удалось загрузить синхронизацию';
    } finally {
      isLoading.value = false;
    }
  }

  async function saveInterval(interval: PushInterval): Promise<void> {
    if (isSaving.value || schedule.value?.interval === interval) return;
    isSaving.value = true;
    saveError.value = null;
    try {
      setSchedule(await stockPushApi.saveInterval(interval));
    } catch (e) {
      saveError.value = e instanceof Error ? e.message : 'Не удалось сохранить частоту';
    } finally {
      isSaving.value = false;
    }
  }

  function reset(): void {
    resetSchedule();
    error.value = null;
    saveError.value = null;
    isSaving.value = false;
  }

  return {
    schedule,
    isLoading,
    hasSchedule,
    error,
    saveError,
    isSaving,
    load,
    saveInterval,
    reset,
  };
}
