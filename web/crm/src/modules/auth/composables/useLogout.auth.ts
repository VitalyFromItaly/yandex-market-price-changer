import { useRouter } from 'vue-router';

import { AUTH_ROUTE } from '../constants/routeNames.auth';
import { useAuthStore } from '../store/store.auth';

import { clearReportCache } from '@/shared/cache';
import { resetAllStores } from '@/shared/store';

/**
 * Выход: чистим данные всех сторов и кэш экранов в localStorage (там деньги и
 * заказы продавца — на общем компьютере они не должны пережить выход), потом
 * сессию, и на экран входа.
 */
export function useLogout() {
  const auth = useAuthStore();
  const router = useRouter();

  async function logout(): Promise<void> {
    resetAllStores();
    clearReportCache();
    auth.clear();
    await router.replace({ name: AUTH_ROUTE.LOGIN.name });
  }

  return { logout };
}
