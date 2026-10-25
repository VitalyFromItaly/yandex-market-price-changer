import { describe, expect, it } from 'vitest';

import { HOME_PATH, NO_STORE_HOME_PATH } from '../constants/routeNames.auth';

import { resolveAuthRoute, safeRedirect } from './useAuthGuard.auth';

const anon = { isAuthenticated: false, mustChangePassword: false, hasStore: null };
const pending = { isAuthenticated: true, mustChangePassword: true, hasStore: null };
const ready = { isAuthenticated: true, mustChangePassword: false, hasStore: true };
const noStore = { ...ready, hasStore: false };

const orders = { name: 'ym-orders', fullPath: '/ym/orders', isPublic: false };
const login = { name: 'login', fullPath: '/login', isPublic: true };
const force = { name: 'force-password', fullPath: '/password', isPublic: false };

describe('resolveAuthRoute', () => {
  it('вход «за продавца» открыт при любой сессии вкладки — он её заменяет', () => {
    const impersonate = { name: 'impersonate', fullPath: '/impersonate', isPublic: true };
    expect(resolveAuthRoute(anon, impersonate)).toBe(true);
    expect(resolveAuthRoute(pending, impersonate)).toBe(true);
    expect(resolveAuthRoute(ready, impersonate)).toBe(true);
  });

  it('без сессии — на вход с возвратом туда, куда шёл', () => {
    expect(resolveAuthRoute(anon, orders)).toEqual({
      name: 'login',
      query: { redirect: '/ym/orders' },
    });
    expect(resolveAuthRoute(anon, login)).toBe(true);
  });

  it('без сессии экран смены пароля тоже закрыт', () => {
    expect(resolveAuthRoute(anon, force)).toMatchObject({ name: 'login' });
  });

  it('пока пароль стартовый — любой маршрут, включая ручной адрес, ведёт на смену', () => {
    expect(resolveAuthRoute(pending, orders)).toEqual({ name: 'force-password' });
    expect(resolveAuthRoute(pending, login)).toEqual({ name: 'force-password' });
    expect(resolveAuthRoute(pending, force)).toBe(true);
  });

  it('после смены вход и смена пароля уводят на главную, разделы открыты', () => {
    expect(resolveAuthRoute(ready, login)).toBe(HOME_PATH);
    expect(resolveAuthRoute(ready, force)).toBe(HOME_PATH);
    expect(resolveAuthRoute(ready, orders)).toBe(true);
  });
});

describe('resolveAuthRoute: продавец без магазина ЯМ (TASK-192)', () => {
  const home = { name: 'ym-stores', fullPath: HOME_PATH, isPublic: false };

  it('главная и экраны входа ведут в «Подключения», остальные адреса открыты', () => {
    expect(resolveAuthRoute(noStore, home)).toBe(NO_STORE_HOME_PATH);
    expect(resolveAuthRoute(noStore, login)).toBe(NO_STORE_HOME_PATH);
    expect(resolveAuthRoute(noStore, force)).toBe(NO_STORE_HOME_PATH);
    expect(resolveAuthRoute(noStore, orders)).toBe(true);
  });

  it('профиль неизвестен или магазин есть — главная прежняя', () => {
    expect(resolveAuthRoute(ready, home)).toBe(true);
    expect(resolveAuthRoute({ ...ready, hasStore: null }, home)).toBe(true);
    expect(resolveAuthRoute({ ...ready, hasStore: null }, login)).toBe(HOME_PATH);
  });

  it('пока пароль стартовый — сначала смена, и без магазина тоже', () => {
    expect(resolveAuthRoute({ ...pending, hasStore: false }, home)).toEqual({
      name: 'force-password',
    });
  });
});

describe('safeRedirect', () => {
  it('только свой путь', () => {
    expect(safeRedirect('/ym/profit')).toBe('/ym/profit');
    expect(safeRedirect('//evil.example')).toBe(HOME_PATH);
    expect(safeRedirect('https://evil.example')).toBe(HOME_PATH);
    expect(safeRedirect(undefined)).toBe(HOME_PATH);
  });
});
