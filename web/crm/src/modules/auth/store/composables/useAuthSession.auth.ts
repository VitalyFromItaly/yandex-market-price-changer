import type { Me, SessionResponse } from '../../auth.domain';

import { computed } from 'vue';

import { authApi } from '../../api/authApi.auth';

import { useBaseState } from '@/shared/composables';

/*
 * Сессия живёт в sessionStorage, а не в localStorage (довод админки): закрыл
 * вкладку — вышел, и токен чужого магазина не лежит на общем компьютере
 * неделю. Хранилище может отсутствовать или бросать (приватный режим, тесты в
 * node) — тогда сессия просто живёт до перезагрузки.
 */
const STORAGE_KEY = 'crm.session';

interface StoredSession {
  token: string;
  mustChangePassword: boolean;
}

function readStored(): StoredSession | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(STORAGE_KEY);
    if (raw === null || raw === undefined) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed.token !== 'string' || parsed.token.length === 0) return null;
    return { token: parsed.token, mustChangePassword: parsed.mustChangePassword === true };
  } catch {
    return null;
  }
}

function writeStored(session: StoredSession | null): void {
  try {
    if (session === null) globalThis.sessionStorage?.removeItem(STORAGE_KEY);
    else globalThis.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Хранилище недоступно — сессия живёт в памяти до перезагрузки.
  }
}

/** Сессия вошедшего: токен, профиль, требование сменить пароль и причина последнего выхода. */
export function useAuthSession() {
  const stored = readStored();
  const [token, setToken, , resetToken] = useBaseState<string | null>(null);
  const [mustChangePassword, setMustChange, , resetMustChange] = useBaseState(false);
  const [me, setMe, isLoadingMe, resetMe] = useBaseState<Me | null>(null);
  const [notice, setNotice, , resetNotice] = useBaseState<string | null>(null);
  const [meLoadedAt, setMeLoadedAt, , resetMeLoadedAt] = useBaseState(0);

  if (stored !== null) {
    setToken(stored.token);
    setMustChange(stored.mustChangePassword);
  }

  const isAuthenticated = computed(() => token.value !== null);

  function persist(): void {
    writeStored(
      token.value === null
        ? null
        : { token: token.value, mustChangePassword: mustChangePassword.value },
    );
  }

  /** Новый токен после входа или смены пароля. Старая причина выхода больше не актуальна. */
  function setSession(session: SessionResponse): void {
    setToken(session.token);
    setMustChange(session.mustChangePassword);
    resetNotice();
    persist();
  }

  /** Перечитать профиль. Ошибку пробрасывает: 401 уже обработан http-клиентом. */
  async function loadMe(): Promise<void> {
    isLoadingMe.value = true;
    try {
      const profile = await authApi.me();
      setMe(profile);
      setMeLoadedAt(Date.now());
      setMustChange(profile.mustChangePassword);
      persist();
    } finally {
      isLoadingMe.value = false;
    }
  }

  /** Выход без участия человека (401): сессия гаснет, причина остаётся для экрана входа. */
  function expire(message: string): void {
    clear();
    setNotice(message);
  }

  /*
   * clear(), а не reset(): стор auth — единственный без reset(), иначе
   * resetAllStores при смене магазина разлогинивал бы (скил pinia-store).
   */
  function clear(): void {
    resetToken();
    resetMustChange();
    resetMe();
    resetMeLoadedAt();
    resetNotice();
    writeStored(null);
  }

  return {
    token,
    mustChangePassword,
    me,
    isLoadingMe,
    notice,
    meLoadedAt,
    isAuthenticated,
    setSession,
    loadMe,
    expire,
    clear,
  };
}
