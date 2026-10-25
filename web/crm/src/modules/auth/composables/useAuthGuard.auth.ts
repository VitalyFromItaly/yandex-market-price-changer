import type { NavigationGuard, RouteLocationNormalized, RouteLocationRaw } from 'vue-router';

import { AUTH_ROUTE, HOME_PATH, NO_STORE_HOME_PATH } from '../constants/routeNames.auth';
import { useAuthStore } from '../store/store.auth';

export interface AuthRouteState {
  isAuthenticated: boolean;
  mustChangePassword: boolean;
  /** Есть ли магазин ЯМ; null — профиль ещё не известен (сбой сети), главная прежняя. */
  hasStore: boolean | null;
}

interface RouteTarget {
  name: RouteLocationNormalized['name'];
  fullPath: string;
  isPublic: boolean;
}

/**
 * Куда пустить. Чистая функция — вся политика входа в одном месте и под тестом:
 *  - без сессии — только публичные маршруты, остальное на вход с возвратом;
 *  - пока стартовый пароль не сменён — только экран смены (решение
 *    crm_initial_password: «заставить сменить»), ручной переход по адресу тоже;
 *  - вошедшему нечего делать на входе и на принудительной смене;
 *  - продавца без магазина ЯМ главная ведёт в «Подключения»: все входы (корень,
 *    старые адреса, после входа и «за продавца») приходят на HOME_PATH.
 */
export function resolveAuthRoute(state: AuthRouteState, to: RouteTarget): true | RouteLocationRaw {
  // Вход «за продавца» заменяет любую сессию вкладки — пускать при любом состоянии.
  if (to.name === AUTH_ROUTE.IMPERSONATE.name) return true;
  if (!state.isAuthenticated) {
    if (to.isPublic) return true;
    const query = to.fullPath === '/' ? {} : { redirect: to.fullPath };
    return { name: AUTH_ROUTE.LOGIN.name, query };
  }
  if (state.mustChangePassword) {
    return to.name === AUTH_ROUTE.FORCE_PASSWORD.name
      ? true
      : { name: AUTH_ROUTE.FORCE_PASSWORD.name };
  }
  const home = state.hasStore === false ? NO_STORE_HOME_PATH : HOME_PATH;
  if (to.name === AUTH_ROUTE.LOGIN.name || to.name === AUTH_ROUTE.FORCE_PASSWORD.name) {
    return home;
  }
  if (to.fullPath === HOME_PATH && home !== HOME_PATH) return home;
  return true;
}

/** Адрес возврата из ?redirect= — только свой путь, не `//чужой.домен`. */
export function safeRedirect(value: unknown): string {
  if (typeof value !== 'string') return HOME_PATH;
  if (!value.startsWith('/') || value.startsWith('//')) return HOME_PATH;
  return value;
}

/** Глобальный гард для центрального роутера. */
export function useAuthGuard(): NavigationGuard {
  return async (to) => {
    const auth = useAuthStore();
    // Сессия есть, профиля нет (перезагрузка вкладки) — узнаём у сервера, жив ли
    // токен и сменён ли пароль. 401 чистит сессию через http-клиент; сбой сети
    // оставляет последнее известное состояние из sessionStorage.
    if (auth.isAuthenticated && auth.me === null && !auth.isLoadingMe) {
      await auth.loadMe().catch(() => undefined);
    }
    return resolveAuthRoute(
      {
        isAuthenticated: auth.isAuthenticated,
        mustChangePassword: auth.mustChangePassword,
        hasStore: auth.me ? auth.me.store !== null : null,
      },
      { name: to.name, fullPath: to.fullPath, isPublic: to.meta.public === true },
    );
  };
}
