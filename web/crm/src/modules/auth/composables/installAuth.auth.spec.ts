import { createPinia, defineStore, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { authApi } from '../api/authApi.auth';
import { useAuthStore } from '../store/store.auth';

import { installAuth } from './installAuth.auth';

import { useBaseState } from '@/shared/composables';
import { http } from '@/shared/http';
import { resettableStoresPlugin } from '@/shared/store';

vi.mock('../api/authApi.auth', () => ({
  authApi: { login: vi.fn(), me: vi.fn(), changePassword: vi.fn() },
}));

const useReportStore = defineStore('report-spec', () => {
  const [data, setData, , resetData] = useBaseState<string | null>(null);
  return { data, setData, reset: resetData };
});

function respond(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

describe('installAuth', () => {
  let router: ReturnType<typeof createRouter>;

  beforeEach(async () => {
    const pinia = createPinia().use(resettableStoresPlugin);
    createApp({}).use(pinia);
    setActivePinia(pinia);
    const page = { template: '<div />' };
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', name: 'login', component: page, meta: { public: true } },
        { path: '/ym/orders', name: 'ym-orders', component: page },
      ],
    });
    await router.push('/ym/orders');
    installAuth(router, pinia);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('токен уходит в каждый запрос', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ token: 't1', mustChangePassword: false });
    await useAuthStore().login({ login: 'vasya', password: 'x' });
    respond(200, {});

    await http.get('/anything');

    const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t1');
  });

  it('401 при живой сессии — данные сторов стёрты, вход с причиной и возвратом', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ token: 't1', mustChangePassword: false });
    const auth = useAuthStore();
    await auth.login({ login: 'vasya', password: 'x' });
    const report = useReportStore();
    report.setData('отчёт магазина');
    respond(401, { message: 'Сессия истекла, войдите заново' });

    await expect(http.get('/anything')).rejects.toThrow();
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('login'));

    expect(auth.token).toBeNull();
    expect(auth.notice).toBe('Сессия истекла, войдите заново');
    expect(report.data).toBeNull();
    expect(router.currentRoute.value.query.redirect).toBe('/ym/orders');
  });

  it('401 без сессии (неверный пароль на входе) — ни выхода, ни «сессия истекла»', async () => {
    respond(401, { message: 'Неверный логин или пароль' });

    await expect(http.post('/auth/login', {})).rejects.toThrow('Неверный логин или пароль');

    expect(useAuthStore().notice).toBeNull();
    expect(router.currentRoute.value.name).toBe('ym-orders');
  });
});
