import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { authApi } from '../api/authApi.auth';

import { useAuthStore } from './store.auth';

import { ApiError } from '@/shared/http';
import { resetAllStores, resettableStoresPlugin } from '@/shared/store';

vi.mock('../api/authApi.auth', () => ({
  authApi: { login: vi.fn(), me: vi.fn(), changePassword: vi.fn() },
}));

const ME = {
  telegramUserId: '222',
  name: 'Вася',
  username: 'vasya',
  isAdmin: false,
  mustChangePassword: false,
  store: null,
  features: {},
  sections: [],
};

/** sessionStorage в node нет — подкладываем Map-реализацию. */
function stubStorage(initial: Record<string, string> = {}): Map<string, string> {
  const data = new Map(Object.entries(initial));
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
  return data;
}

function freshPinia(): void {
  const pinia = createPinia().use(resettableStoresPlugin);
  createApp({}).use(pinia);
  setActivePinia(pinia);
}

describe('useAuthStore', () => {
  beforeEach(() => {
    vi.mocked(authApi.login).mockReset();
    vi.mocked(authApi.me).mockReset();
    vi.mocked(authApi.changePassword).mockReset();
    freshPinia();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('вход кладёт токен в sessionStorage и сообщает про обязательную смену', async () => {
    const storage = stubStorage();
    vi.mocked(authApi.login).mockResolvedValue({ token: 't1', mustChangePassword: true });
    const auth = useAuthStore();

    expect(await auth.login({ login: 'vasya', password: 'tg_rules_2026' })).toBe(true);
    expect(auth.token).toBe('t1');
    expect(auth.mustChangePassword).toBe(true);
    expect(JSON.parse(storage.get('crm.session') ?? '{}')).toEqual({
      token: 't1',
      mustChangePassword: true,
    });
  });

  it('сессия переживает перезагрузку вкладки', () => {
    stubStorage({ 'crm.session': JSON.stringify({ token: 't1', mustChangePassword: true }) });
    const auth = useAuthStore();
    expect(auth.isAuthenticated).toBe(true);
    expect(auth.mustChangePassword).toBe(true);
  });

  it('мусор в хранилище — не сессия', () => {
    stubStorage({ 'crm.session': '{не json' });
    expect(useAuthStore().isAuthenticated).toBe(false);
  });

  it('без sessionStorage (node, приватный режим) сессия живёт в памяти', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ token: 't1', mustChangePassword: false });
    const auth = useAuthStore();
    await auth.login({ login: 'vasya', password: 'x' });
    expect(auth.token).toBe('t1');
  });

  it('ошибка входа не трогает состояние и уходит наверх с текстом сервера', async () => {
    vi.mocked(authApi.login).mockRejectedValue(new ApiError('Неверный логин или пароль', 401));
    const auth = useAuthStore();
    await expect(auth.login({ login: 'vasya', password: 'x' })).rejects.toThrow(
      'Неверный логин или пароль',
    );
    expect(auth.token).toBeNull();
  });

  it('смена пароля: новый токен сразу, профиль перечитан — повторный вход не нужен', async () => {
    const storage = stubStorage();
    vi.mocked(authApi.login).mockResolvedValue({ token: 'old', mustChangePassword: true });
    vi.mocked(authApi.changePassword).mockResolvedValue({
      token: 'new',
      mustChangePassword: false,
    });
    vi.mocked(authApi.me).mockResolvedValue(ME);
    const auth = useAuthStore();
    await auth.login({ login: 'vasya', password: 'tg_rules_2026' });

    await auth.changePassword('tg_rules_2026', 'my-own-password');

    expect(auth.token).toBe('new');
    expect(auth.mustChangePassword).toBe(false);
    expect(auth.me?.name).toBe('Вася');
    expect(auth.meLoadedAt).toBeGreaterThan(0);
    expect(JSON.parse(storage.get('crm.session') ?? '{}').token).toBe('new');
  });

  it('упавшая смена пароля оставляет прежнюю сессию', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ token: 'old', mustChangePassword: true });
    vi.mocked(authApi.changePassword).mockRejectedValue(
      new ApiError('Текущий пароль неверен', 400),
    );
    const auth = useAuthStore();
    await auth.login({ login: 'vasya', password: 'tg_rules_2026' });

    await expect(auth.changePassword('x', 'my-own-password')).rejects.toThrow();
    expect(auth.token).toBe('old');
    expect(auth.mustChangePassword).toBe(true);
  });

  it('expire — сессии нет, причина осталась; новый вход причину стирает', async () => {
    const storage = stubStorage();
    vi.mocked(authApi.login).mockResolvedValue({ token: 't1', mustChangePassword: false });
    const auth = useAuthStore();
    await auth.login({ login: 'vasya', password: 'x' });

    auth.expire('Сессия истекла, войдите заново');
    expect(auth.token).toBeNull();
    expect(auth.notice).toBe('Сессия истекла, войдите заново');
    expect(storage.has('crm.session')).toBe(false);

    await auth.login({ login: 'vasya', password: 'x' });
    expect(auth.notice).toBeNull();
  });

  it('clear() обнуляет всё; resetAllStores (смена магазина) сессию не трогает', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ token: 't1', mustChangePassword: false });
    vi.mocked(authApi.me).mockResolvedValue(ME);
    const auth = useAuthStore();
    await auth.login({ login: 'vasya', password: 'x' });
    await auth.loadMe();

    expect('reset' in auth).toBe(false);
    resetAllStores();
    expect(auth.token).toBe('t1');

    auth.clear();
    expect(auth.token).toBeNull();
    expect(auth.me).toBeNull();
    expect(auth.mustChangePassword).toBe(false);
    expect(auth.meLoadedAt).toBe(0);
  });

  it('loadMe при ошибке снимает флаг загрузки и пробрасывает ошибку', async () => {
    vi.mocked(authApi.me).mockRejectedValue(new ApiError('Нет связи', 0));
    const auth = useAuthStore();
    await expect(auth.loadMe()).rejects.toThrow('Нет связи');
    expect(auth.isLoadingMe).toBe(false);
    expect(auth.me).toBeNull();
  });
});
