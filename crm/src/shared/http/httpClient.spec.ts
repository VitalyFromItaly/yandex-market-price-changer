import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  NETWORK_ERROR_STATUS,
  http,
  onUnauthorized,
  setTokenProvider,
} from './httpClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('httpClient', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokenProvider(() => null);
    onUnauthorized(null);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('ходит на /api/crm и подставляет Bearer', async () => {
    setTokenProvider(() => 'jwt-1');
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    await expect(http.post('/auth/login', { login: 'a' })).resolves.toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/crm/auth/login');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer jwt-1');
    expect(init?.body).toBe(JSON.stringify({ login: 'a' }));
  });

  it('без токена заголовка нет', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    await http.get('/auth/me');
    const init = fetchMock.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('403 с code отдаёт ApiError.code и текст сервера', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, {
        statusCode: 403,
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Сначала смените стартовый пароль',
      }),
    );
    const error = await http.get('/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(403);
    expect((error as ApiError).code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((error as ApiError).message).toBe('Сначала смените стартовый пароль');
  });

  it('400 с field — поле формы, под которое встанет ошибка', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { code: 'INVALID_SETTING', field: 'taxPercent', message: 'Налог…' }),
    );
    await expect(http.put('/x', {})).rejects.toMatchObject({
      code: 'INVALID_SETTING',
      field: 'taxPercent',
    });
  });

  it('message-массив валидации Nest превращается в первую строку', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { statusCode: 400, message: ['Первое', 'Второе'] }),
    );
    await expect(http.get('/x')).rejects.toMatchObject({ message: 'Первое', code: null });
  });

  it('401 зовёт onUnauthorized и всё равно бросает', async () => {
    const handler = vi.fn();
    onUnauthorized(handler);
    fetchMock.mockResolvedValue(
      jsonResponse(401, { statusCode: 401, message: 'Сессия истекла, войдите заново' }),
    );

    await expect(http.get('/auth/me')).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('сетевой сбой — понятный русский текст и статус 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(http.get('/x')).rejects.toMatchObject({
      status: NETWORK_ERROR_STATUS,
      message: 'Нет связи с сервером. Проверьте интернет и повторите.',
    });
  });

  it('5xx без тела — общий текст, не пустая строка', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 502 }));
    await expect(http.get('/x')).rejects.toMatchObject({
      status: 502,
      message: 'Сервер не ответил как положено. Попробуйте ещё раз.',
    });
  });
});

describe('filenameOf', () => {
  it('UTF-8 имя важнее ASCII-запасного', async () => {
    const { filenameOf } = await import('./httpClient');
    const header = `attachment; filename="_____.xlsx"; filename*=UTF-8''${encodeURIComponent('отчёт.xlsx')}`;
    expect(filenameOf(header)).toBe('отчёт.xlsx');
    expect(filenameOf('attachment; filename="a.xlsx"')).toBe('a.xlsx');
    expect(filenameOf(null)).toBeNull();
  });
});

describe('http.file', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('отдаёт blob и имя; ошибка — тот же ApiError, что у JSON', async () => {
    const { http: client, setTokenProvider: setToken } = await import('./httpClient');
    const fetchFile = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchFile);
    setToken(() => 'jwt-1');
    fetchFile.mockResolvedValueOnce(
      new Response('PK', {
        status: 200,
        headers: { 'Content-Disposition': 'attachment; filename="r.xlsx"' },
      }),
    );
    const file = await client.file('/ym/jobs/j1/file');
    expect(await file.blob.text()).toBe('PK');
    expect(file.filename).toBe('r.xlsx');
    expect((fetchFile.mock.calls[0]?.[1]?.headers as Record<string, string>).Authorization).toBe(
      'Bearer jwt-1',
    );

    fetchFile.mockResolvedValueOnce(jsonResponse(404, { message: 'Задача не найдена' }));
    await expect(client.file('/ym/jobs/x/file')).rejects.toMatchObject({
      status: 404,
      message: 'Задача не найдена',
    });
    setToken(() => null);
  });
});
