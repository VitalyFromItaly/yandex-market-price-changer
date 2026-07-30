import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { AppConfigService } from '../../src/config/app-config.service';
import { TelegramApiService } from '../../src/modules/telegram/services/telegram.api.service';

/**
 * Уведомления из очередей — единственный путь, который собирает URL к Bot API
 * руками, а не через telegraf. Именно поэтому он и остался бы ходить на
 * api.telegram.org напрямую, когда всё остальное уже ушло на зеркало: отчёт
 * просто не доходил бы до пользователя, а логи выглядели бы как сетевая ошибка.
 * Тест фиксирует, что хост берётся из конфига.
 */
describe('TelegramApiService: адрес Bot API берётся из конфига', () => {
  const TOKEN = '123456:AAbbCC';
  let fetchMock: ReturnType<typeof vi.fn>;

  function build(apiUrl: string): TelegramApiService {
    return new TelegramApiService({ telegramApiUrl: apiUrl } as AppConfigService);
  }

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('шлёт запрос на зеркало, а не на api.telegram.org', async () => {
    await build('https://tg-api-proxy.example.com').sendMessage(TOKEN, '42', 'привет');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://tg-api-proxy.example.com/bot${TOKEN}/sendMessage`);
    expect(url).not.toContain('api.telegram.org');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ chat_id: '42', text: 'привет' });
  });

  it('без зеркала ходит напрямую', async () => {
    await build('https://api.telegram.org').sendMessage(TOKEN, '42', 'привет');

    expect(fetchMock.mock.calls[0][0]).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
  });

  it('длинный текст режется на части, и каждая уходит на то же зеркало', async () => {
    // Лимит Telegram — 4096; проверяем, что нормализация URL не потерялась во
    // втором и последующих запросах.
    await build('https://tg-api-proxy.example.com').sendMessage(TOKEN, '42', 'я'.repeat(5000));

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    for (const [url] of fetchMock.mock.calls) {
      expect(url).toBe(`https://tg-api-proxy.example.com/bot${TOKEN}/sendMessage`);
    }
  });

  it('ошибка Bot API пробрасывается с описанием из тела ответа', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ description: "Can't parse entities" }),
    });

    await expect(
      build('https://tg-api-proxy.example.com').sendMessage(TOKEN, '42', 'x'),
    ).rejects.toThrow("Can't parse entities");
  });
});
