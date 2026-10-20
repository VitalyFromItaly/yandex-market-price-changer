import type { Pinia } from 'pinia';
import type { Router } from 'vue-router';

import { AUTH_ROUTE, SESSION_EXPIRED_TEXT } from '../constants/routeNames.auth';
import { useAuthStore } from '../store/store.auth';

import { clearReportCache, setCacheOwner } from '@/shared/cache';
import { onUnauthorized, setTokenProvider } from '@/shared/http';
import { resetAllStores } from '@/shared/store';

/**
 * Связка http-клиента с сессией: токен в каждый запрос, 401 с любого запроса —
 * выход на вход с причиной. shared/http о сторах не знает, поэтому связку
 * ставит модуль auth (зовётся из main.ts).
 */
export function installAuth(router: Router, pinia: Pinia): void {
  const auth = useAuthStore(pinia);

  setTokenProvider(() => auth.token);
  // Кэш экранов — по продавцу: пока /auth/me не пришёл, владельца нет и кэша тоже.
  setCacheOwner(() => auth.me?.telegramUserId ?? null);

  onUnauthorized((error) => {
    // 401 без сессии — это неверный пароль на самом входе: ошибка формы, а не
    // «сессия истекла».
    if (auth.token === null) return;

    const current = router.currentRoute.value;
    const redirect = current.meta.public === true ? undefined : current.fullPath;
    resetAllStores();
    clearReportCache();
    auth.expire(error.message.length > 0 ? error.message : SESSION_EXPIRED_TEXT);
    void router.replace({
      name: AUTH_ROUTE.LOGIN.name,
      query: redirect === undefined || redirect === '/' ? {} : { redirect },
    });
  });
}
