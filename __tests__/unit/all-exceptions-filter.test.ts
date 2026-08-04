import type { ArgumentsHost } from '@nestjs/common';

import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';

import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';

/**
 * Глобальный фильтр HTTP-ошибок.
 *
 * Ключевое: 404 на НЕсматченный маршрут (сканеры `GET /.env`, `/.git/config`)
 * пишется с `source=scanner` — панель уводит такие записи в отдельную вкладку
 * «Мусор» и прячет из основного журнала. Всё остальное (5xx, 401, 404 из
 * реального контроллера) записывается с обычным source; ответ клиенту не
 * меняется.
 */
describe('AllExceptionsFilter', () => {
  function run(
    exception: unknown,
    request: { method: string; url: string; route?: { path: string } },
  ) {
    const report = vi.fn().mockResolvedValue(undefined);
    const filter = new AllExceptionsFilter({ report } as never);

    const json = vi.fn();
    const response = { status: vi.fn(() => ({ json })), json };
    const host = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;

    filter.catch(exception, host);
    return { report, response, json };
  }

  it('404 на несматченный маршрут (сканер) пишется с source=scanner, без алерта', () => {
    const { report, response } = run(new NotFoundException('Cannot GET /.env'), {
      method: 'GET',
      url: '/.env',
      route: undefined, // маршрут не сматчился
    });

    expect(report).toHaveBeenCalledTimes(1);
    const entry = report.mock.calls[0][0];
    expect(entry.source).toBe('scanner');
    expect(entry.alert).toBe(false);
    // Клиенту всё равно отвечаем 404.
    expect(response.status).toHaveBeenCalledWith(404);
  });

  it('404 из реального контроллера (маршрут сматчился) — обычный source http', () => {
    const { report } = run(new NotFoundException('Продавец не найден'), {
      method: 'GET',
      url: '/api/access/users/999',
      route: { path: '/api/access/users/:id' },
    });

    expect(report).toHaveBeenCalledTimes(1);
    const entry = report.mock.calls[0][0];
    expect(entry.httpStatus).toBe(404);
    expect(entry.source).toBe('http');
    expect(entry.alert).toBe(false);
  });

  it('5xx записывается и будит алертом', () => {
    const { report } = run(new Error('boom'), { method: 'POST', url: '/api/logs' });

    expect(report).toHaveBeenCalledTimes(1);
    const entry = report.mock.calls[0][0];
    expect(entry.httpStatus).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(entry.alert).toBe(true);
  });

  it('401 записывается, но без алерта (поведение клиента)', () => {
    const { report } = run(new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED), {
      method: 'POST',
      url: '/api/auth/login',
      route: { path: '/api/auth/login' },
    });

    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0].alert).toBe(false);
  });
});
