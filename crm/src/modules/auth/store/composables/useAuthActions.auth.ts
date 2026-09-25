import type { LoginForm, SessionResponse } from '../../auth.domain';

import { authApi } from '../../api/authApi.auth';

/**
 * Действия входа: логин и смена пароля. Оба кончаются новой сессией — её
 * кладёт setSession слайса сессии (передаётся проводкой, наружу не торчит).
 * Ошибки пробрасываются как есть: у ApiError уже человеческий текст сервера и
 * код, по которому форма ставит ошибку под нужное поле.
 */
export function useAuthActions(
  setSession: (session: SessionResponse) => void,
  loadMe: () => Promise<void>,
) {
  /** Вход. Возвращает, нужно ли сначала сменить пароль. */
  async function login(form: LoginForm): Promise<boolean> {
    const session = await authApi.login(form);
    setSession(session);
    return session.mustChangePassword;
  }

  /** Смена пароля: новый токен сразу в сессию — повторный вход не нужен. */
  async function changePassword(current: string, next: string): Promise<void> {
    setSession(await authApi.changePassword(current, next));
    await loadMe();
  }

  return { login, changePassword };
}
