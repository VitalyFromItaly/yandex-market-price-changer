import type { PasswordErrors, PasswordForm } from '../auth.domain';

import { AUTH_ERROR_CODE, MIN_PASSWORD_LENGTH } from '../auth.domain';

import { ApiError } from '@/shared/http';

/**
 * Ошибка сервера → под какое поле её поставить. По коду, а не по тексту:
 * формулировку на бэкенде можно поправить, не сломав форму.
 */
export function mapPasswordError(error: unknown): PasswordErrors {
  const message = error instanceof Error ? error.message : 'Не удалось сменить пароль';
  if (error instanceof ApiError) {
    if (error.code === AUTH_ERROR_CODE.WRONG_CURRENT_PASSWORD) return { current: message };
    if (error.code === AUTH_ERROR_CODE.WEAK_PASSWORD) return { next: message };
  }
  return { form: message };
}

/** Клиентская проверка до запроса: длина и совпадение повтора. Остальное решает сервер. */
export function validatePasswordForm(form: PasswordForm): PasswordErrors {
  const errors: PasswordErrors = {};
  if (form.current.length === 0) errors.current = 'Введите текущий пароль';
  if (form.next.length < MIN_PASSWORD_LENGTH) {
    errors.next = `Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов`;
  }
  if (form.repeat !== form.next) errors.repeat = 'Пароли не совпадают';
  return errors;
}
