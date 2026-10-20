import { useDocumentVisibility } from '@vueuse/core';
import { watch } from 'vue';

import { useAuthStore } from '../store/store.auth';

/** Не чаще раза в 30 секунд: переключение вкладок туда-сюда не должно долбить сервер. */
export const SESSION_REFRESH_INTERVAL_MS = 30_000;

export function shouldRefreshSession(loadedAt: number, now: number): boolean {
  return now - loadedAt >= SESSION_REFRESH_INTERVAL_MS;
}

/**
 * Перечитывает профиль, когда человек возвращается на вкладку. Пароль сменили в
 * другой вкладке или доступ отозвали в боте — эта вкладка узнает только на
 * запросе, а на экране без запросов не узнает никогда. 401 выкинет на вход
 * через http-клиент.
 */
export function useSessionRefresh(): void {
  const auth = useAuthStore();
  const visibility = useDocumentVisibility();

  watch(visibility, (state) => {
    if (state !== 'visible' || !auth.isAuthenticated || auth.isLoadingMe) return;
    if (!shouldRefreshSession(auth.meLoadedAt, Date.now())) return;
    void auth.loadMe().catch(() => undefined);
  });
}
