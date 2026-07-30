import { describe, it, expect } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

import { AdminApiGuard, ADMIN_ID_HEADER } from '../../src/common/guards/admin-api.guard';
import type { AppConfigService } from '../../src/config/app-config.service';

/**
 * Единственная защита журнала действий, а в нём — id и сообщения пользователей.
 * Проверяется в первую очередь то, что должно быть ЗАПРЕЩЕНО.
 */
const TOKEN = 's3cret-token-of-sufficient-length';
const ADMIN_ID = 309809755;

function guardWith(overrides: Partial<AppConfigService> = {}) {
  const config = {
    adminApiToken: TOKEN,
    isAdmin: (id: number | string) => Number(id) === ADMIN_ID,
    ...overrides,
  } as AppConfigService;
  return new AdminApiGuard(config);
}

function contextOf(headers: Record<string, string | undefined>) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as never;
}

const validHeaders = {
  authorization: `Bearer ${TOKEN}`,
  [ADMIN_ID_HEADER]: String(ADMIN_ID),
};

describe('AdminApiGuard', () => {
  it('пропускает админа с верным токеном', () => {
    expect(guardWith().canActivate(contextOf(validHeaders))).toBe(true);
  });

  it('без заданного ADMIN_API_TOKEN не пускает НИКОГО', () => {
    // «Не настроено» обязано означать «закрыто». Обратное поведение отдало бы
    // переписку пользователей любому, кто знает адрес.
    const guard = guardWith({ adminApiToken: undefined });
    expect(() => guard.canActivate(contextOf(validHeaders))).toThrow(UnauthorizedException);
  });

  it.each([
    ['без заголовка Authorization', { [ADMIN_ID_HEADER]: String(ADMIN_ID) }],
    ['с чужим токеном', { ...validHeaders, authorization: 'Bearer wrong-token-wrong-token-x' }],
    ['без схемы Bearer', { ...validHeaders, authorization: TOKEN }],
  ])('отклоняет запрос %s', (_name, headers) => {
    expect(() => guardWith().canActivate(contextOf(headers as never))).toThrow(UnauthorizedException);
  });

  it('отклоняет верный токен без заголовка с id', () => {
    const headers = { authorization: `Bearer ${TOKEN}` };
    expect(() => guardWith().canActivate(contextOf(headers))).toThrow(UnauthorizedException);
  });

  it('отклоняет верный токен с id НЕ из TELEGRAM_ADMIN_IDS', () => {
    // Отзыв админа в переменной окружения обязан закрывать и API тоже.
    const headers = { ...validHeaders, [ADMIN_ID_HEADER]: '111222333' };
    expect(() => guardWith().canActivate(contextOf(headers))).toThrow(UnauthorizedException);
  });

  it('токен длиннее ожидаемого не проходит', () => {
    // Проверка постоянного времени сравнивает буферы и требует равной длины —
    // важно, чтобы это не превратилось в «совпал префикс, значит пустили».
    const headers = { ...validHeaders, authorization: `Bearer ${TOKEN}xx` };
    expect(() => guardWith().canActivate(contextOf(headers))).toThrow(UnauthorizedException);
  });

  it('схема Bearer читается без учёта регистра', () => {
    const headers = { ...validHeaders, authorization: `bearer ${TOKEN}` };
    expect(guardWith().canActivate(contextOf(headers))).toBe(true);
  });
});
