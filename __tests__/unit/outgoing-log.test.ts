import { describe, it, expect, vi } from 'vitest';

import { BotRegistry } from '../../src/modules/telegram/bots/bot-registry.service';

/**
 * Перехват исходящих вызовов Bot API.
 *
 * Проверяется на живом объекте BotRegistry, а не на копии логики: суть здесь
 * именно в подмене telegram.callApi — что она пропускает вызов насквозь,
 * фильтрует служебные методы и не мешает боту ответить, если журнал упал.
 */
describe('BotRegistry: журнал исходящих', () => {
  function build() {
    const record = vi.fn().mockResolvedValue(undefined);
    const report = vi.fn().mockResolvedValue(undefined);

    // Зависимости, которые перехвату не нужны: он не трогает ни базу ботов,
    // ни композер, ни конфиг.
    const registry = new BotRegistry(
      null as never,
      null as never,
      null as never,
      { record } as never,
      { report } as never,
    );

    const callApi = vi.fn().mockResolvedValue({ message_id: 1 });
    const telegraf = { telegram: { callApi }, botInfo: { id: 42 } };

    // logOutgoing приватен — он деталь реализации registerBot, но проверять
    // его через полную регистрацию бота значило бы поднимать Telegraf и сеть.
    (registry as never as { logOutgoing(t: unknown, d: unknown): void }).logOutgoing(telegraf, {
      id: 'doc1',
    });

    return { registry, telegraf, callApi, record, report };
  }

  it('записывает отправленное пользователю сообщение', async () => {
    const { telegraf, record } = build();

    await telegraf.telegram.callApi('sendMessage', { chat_id: 777, text: 'Отчёт готов' });

    expect(record).toHaveBeenCalledTimes(1);
    const entry = record.mock.calls[0][0];
    expect(entry.direction).toBe('out');
    expect(entry.telegramUserId).toBe('777');
    expect(entry.chatId).toBe('777');
    expect(entry.kind).toBe('sendMessage');
    expect(entry.action).toBe('Отчёт готов');
    expect(entry.botId).toBe('42');
  });

  it('НЕ записывает служебные вызовы', async () => {
    // getUpdates в режиме polling идёт непрерывно — если он попадёт в журнал,
    // журнал будет состоять только из него.
    const { telegraf, record } = build();

    await telegraf.telegram.callApi('getUpdates', { timeout: 30 });
    await telegraf.telegram.callApi('getMe', {});
    await telegraf.telegram.callApi('setWebhook', { url: 'https://example.com' });

    expect(record).not.toHaveBeenCalled();
  });

  it('пропускает вызов насквозь и возвращает результат Bot API', async () => {
    // Перехват обязан быть прозрачным: telegraf ждёт от callApi настоящий
    // ответ, а хендлеры — message_id.
    const { telegraf, callApi } = build();

    const result = await telegraf.telegram.callApi('sendMessage', { chat_id: 1, text: 'x' });

    expect(result).toEqual({ message_id: 1 });
    expect(callApi).toHaveBeenCalledWith('sendMessage', { chat_id: 1, text: 'x' }, undefined);
  });

  it('ошибка Bot API пробрасывается и попадает в журнал ошибок', async () => {
    // «Бот не смог ответить» — самый заметный для пользователя класс сбоев:
    // он нажал кнопку и не получил ничего. Раньше запись делалась только
    // после успешного вызова, и такие случаи терялись целиком.
    const { telegraf, callApi, record, report } = build();
    callApi.mockRejectedValueOnce(new Error('403 Forbidden: bot was blocked by the user'));

    await expect(telegraf.telegram.callApi('sendMessage', { chat_id: 1, text: 'x' })).rejects.toThrow(
      '403',
    );

    // В журнал ДЕЙСТВИЙ не пишем: сообщение не ушло, отправкой это не было.
    expect(record).not.toHaveBeenCalled();

    expect(report).toHaveBeenCalledTimes(1);
    const reported = report.mock.calls[0][0];
    expect(reported.context).toBe('send:sendMessage');
    expect(reported.telegramUserId).toBe('1');
    expect(reported.source).toBe('bot');
  });

  it('падение служебного вызова журнал ошибок не засоряет', async () => {
    // getUpdates при обрыве сети падает постоянно; алерт на каждый такой
    // случай — это лента из сотен сообщений про одно и то же.
    const { telegraf, callApi, report } = build();
    callApi.mockRejectedValueOnce(new Error('socket hang up'));

    await expect(telegraf.telegram.callApi('getUpdates', { timeout: 30 })).rejects.toThrow();
    expect(report).not.toHaveBeenCalled();
  });

  it('сбой журнала не мешает боту ответить', async () => {
    const record = vi.fn().mockRejectedValue(new Error('mongo недоступна'));
    const registry = new BotRegistry(
      null as never,
      null as never,
      null as never,
      { record } as never,
      { report: vi.fn() } as never,
    );
    const telegraf = { telegram: { callApi: vi.fn().mockResolvedValue('ok') }, botInfo: { id: 1 } };
    (registry as never as { logOutgoing(t: unknown, d: unknown): void }).logOutgoing(telegraf, {
      id: 'doc1',
    });

    await expect(
      telegraf.telegram.callApi('sendMessage', { chat_id: 1, text: 'x' }),
    ).resolves.toBe('ok');
  });
});
