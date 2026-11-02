import type { OzonPushStatus, PushInterval, PushSchedule } from '../../stock-push.domain';

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
  const isRotating = ref(false);
  const ozonPush = ref<OzonPushStatus | null>(null);
  const isOzonBusy = ref(false);

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

  /** Новый адрес; ошибка — текстом под кнопкой. Подписку Ozon перечитываем: сервер её перенаправил. */
  async function rotateSecret(): Promise<void> {
    if (isRotating.value) return;
    isRotating.value = true;
    saveError.value = null;
    try {
      setSchedule(await stockPushApi.rotateSecret());
      if (ozonPush.value) await loadOzonPush();
    } catch (e) {
      saveError.value = e instanceof Error ? e.message : 'Не удалось сменить адрес';
    } finally {
      isRotating.value = false;
    }
  }

  async function loadOzonPush(): Promise<void> {
    await ozonCall(() => stockPushApi.ozonStatus());
  }

  async function connectOzonPush(): Promise<void> {
    await ozonCall(() => stockPushApi.ozonConnect());
  }

  /** Сбой сети — тоже статус: кнопка «Подключить» остаётся, текст объясняет. */
  async function ozonCall(call: () => Promise<OzonPushStatus>): Promise<void> {
    if (isOzonBusy.value) return;
    isOzonBusy.value = true;
    try {
      ozonPush.value = await call();
    } catch (e) {
      ozonPush.value = {
        state: 'error',
        ok: false,
        text: e instanceof Error ? e.message : 'Не удалось проверить уведомления Ozon',
      };
    } finally {
      isOzonBusy.value = false;
    }
  }

  function reset(): void {
    resetSchedule();
    error.value = null;
    saveError.value = null;
    isSaving.value = false;
    isRotating.value = false;
    ozonPush.value = null;
    isOzonBusy.value = false;
  }

  return {
    schedule,
    isLoading,
    hasSchedule,
    error,
    saveError,
    isSaving,
    isRotating,
    ozonPush,
    isOzonBusy,
    load,
    saveInterval,
    rotateSecret,
    loadOzonPush,
    connectOzonPush,
    reset,
  };
}
