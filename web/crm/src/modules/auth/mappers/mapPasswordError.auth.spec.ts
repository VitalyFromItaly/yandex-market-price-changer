import { describe, expect, it } from 'vitest';

import { AUTH_ERROR_CODE } from '../auth.domain';

import { mapPasswordError, validatePasswordForm } from './mapPasswordError.auth';

import { ApiError } from '@/shared/http';

describe('mapPasswordError', () => {
  it('неверный текущий — под полем текущего пароля', () => {
    const error = new ApiError(
      'Текущий пароль неверен',
      400,
      AUTH_ERROR_CODE.WRONG_CURRENT_PASSWORD,
    );
    expect(mapPasswordError(error)).toEqual({ current: 'Текущий пароль неверен' });
  });

  it('слабый или стартовый — под полем нового пароля', () => {
    const error = new ApiError(
      'Стартовый пароль нельзя оставить',
      400,
      AUTH_ERROR_CODE.WEAK_PASSWORD,
    );
    expect(mapPasswordError(error)).toEqual({ next: 'Стартовый пароль нельзя оставить' });
  });

  it('всё остальное (блокировка, сеть) — над кнопкой', () => {
    expect(mapPasswordError(new ApiError('Нет связи с сервером', 0))).toEqual({
      form: 'Нет связи с сервером',
    });
  });
});

describe('validatePasswordForm', () => {
  it('короткий новый и несовпадающий повтор — две ошибки у своих полей', () => {
    expect(validatePasswordForm({ current: 'x', next: 'short', repeat: 'other' })).toEqual({
      next: 'Пароль должен быть не короче 10 символов',
      repeat: 'Пароли не совпадают',
    });
  });

  it('пустой текущий не уходит на сервер', () => {
    expect(
      validatePasswordForm({ current: '', next: 'long-enough-1', repeat: 'long-enough-1' }),
    ).toEqual({
      current: 'Введите текущий пароль',
    });
  });

  it('годная форма — без ошибок', () => {
    expect(
      validatePasswordForm({ current: 'x', next: 'long-enough-1', repeat: 'long-enough-1' }),
    ).toEqual({});
  });
});
