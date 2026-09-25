import { describe, expect, it } from 'vitest';

import { HOME_PATH } from '../constants/routeNames.auth';

import { resolveAuthRoute, safeRedirect } from './useAuthGuard.auth';

const anon = { isAuthenticated: false, mustChangePassword: false };
const pending = { isAuthenticated: true, mustChangePassword: true };
const ready = { isAuthenticated: true, mustChangePassword: false };

const orders = { name: 'ym-orders', fullPath: '/ym/orders', isPublic: false };
const login = { name: 'login', fullPath: '/login', isPublic: true };
const force = { name: 'force-password', fullPath: '/password', isPublic: false };

describe('resolveAuthRoute', () => {
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

describe('safeRedirect', () => {
  it('только свой путь', () => {
    expect(safeRedirect('/ym/profit')).toBe('/ym/profit');
    expect(safeRedirect('//evil.example')).toBe(HOME_PATH);
    expect(safeRedirect('https://evil.example')).toBe(HOME_PATH);
    expect(safeRedirect(undefined)).toBe(HOME_PATH);
  });
});
