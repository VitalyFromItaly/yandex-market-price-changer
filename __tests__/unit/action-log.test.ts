import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';

import {
  describeAction,
  describeOutgoing,
  fullName,
  maskOutgoing,
  maskSecrets,
  outgoingSourceOf,
  truncate,
  MAX_ACTION_LENGTH,
  MAX_OUTGOING_LENGTH,
  OUTGOING_METHODS,
  SECRET_PLACEHOLDER,
} from '../../src/modules/telegram/bots/shared/action-log.domain';
import { ActionLogHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/action-log.handler';
import { ActionLogService } from '../../src/database/services/action-log.service';
import { MENU } from '../../src/modules/telegram/bots/price-changer-bot/menu.constants';

/**
 * Журнал действий. Проверяется прежде всего то, что в него НЕ должно попасть:
 * во время регистрации продавец присылает токен Партнёрского API обычным
 * сообщением, и незамаскированный журнал стал бы второй копией чужих доступов.
 */
describe('maskSecrets', () => {
  it('вырезает токен, присланный отдельным сообщением', () => {
    // Ровно так выглядит шаг регистрации: пользователь вставляет токен в чат.
    const token = 'ACMA5ba7c9d1e2f3a4b5c6d7e8f9a0b1c2';
    expect(maskSecrets(token)).toBe(SECRET_PLACEHOLDER);
    expect(maskSecrets(token)).not.toContain('ACMA');
  });

  it('вырезает токен с подписью — так просит экран изменения настроек', () => {
    const masked = maskSecrets('токен: ACMA5ba7c9d1e2f3a4b5c6d7e8f9a0b1c2');
    expect(masked).not.toContain('ACMA5ba7c9d1');
    expect(masked).toContain('токен:');
  });

  it.each(['token: abc123def456ghi789', 'api_key: qqqwwweeerrrtttyyy', 'API-KEY: zzzxxxcccvvvbbb'])(
    'вырезает значение из %o',
    (input) => {
      const masked = maskSecrets(input);
      expect(masked).toContain(SECRET_PLACEHOLDER);
    },
  );

  it('вырезает campaign_id и business_id', () => {
    // Их не показывают даже владельцу магазина — тем более им не место здесь.
    expect(maskSecrets('12345678')).toBe(SECRET_PLACEHOLDER);
    expect(maskSecrets('мой магазин 987654321 проверь')).not.toContain('987654321');
  });

  it('не трогает обычную речь и подписи кнопок', () => {
    expect(maskSecrets('привет, не работает отчёт')).toBe('привет, не работает отчёт');
    expect(maskSecrets(MENU.PROFIT)).toBe(MENU.PROFIT);
  });

  it('не считает секретом короткие числа — их полно в обычных сообщениях', () => {
    // Комиссия «23» и время «09:00» должны читаться в журнале как есть.
    expect(maskSecrets('комиссия: 23')).toBe('комиссия: 23');
    expect(maskSecrets('09:00')).toBe('09:00');
  });
});

describe('truncate', () => {
  it('режет длинный текст и помечает обрезку', () => {
    const long = 'а'.repeat(MAX_ACTION_LENGTH + 50);
    const cut = truncate(long);
    expect(cut.length).toBe(MAX_ACTION_LENGTH + 1);
    expect(cut.endsWith('…')).toBe(true);
  });

  it('короткий текст оставляет как есть', () => {
    expect(truncate('коротко')).toBe('коротко');
  });
});

describe('describeAction', () => {
  it('слэш-команда', () => {
    expect(describeAction({ text: '/start' })).toEqual({ kind: 'command', action: '/start' });
    expect(describeAction({ text: '/profile' }).kind).toBe('command');
  });

  it('кнопка меню опознаётся по подписи', () => {
    expect(describeAction({ text: MENU.PROFIT })).toEqual({ kind: 'menu', action: MENU.PROFIT });
  });

  it('inline-кнопка — это callback_data', () => {
    expect(describeAction({ callbackData: 'rep:month:profit' })).toEqual({
      kind: 'callback',
      action: 'rep:month:profit',
    });
  });

  it('документ — имя файла', () => {
    expect(describeAction({ documentName: 'stock.xlsx' })).toEqual({
      kind: 'document',
      action: 'stock.xlsx',
    });
  });

  it('документ без имени всё равно записывается', () => {
    expect(describeAction({ documentName: 'файл без имени' }).kind).toBe('document');
  });

  it('свободный текст маскируется', () => {
    const described = describeAction({ text: 'ACMA5ba7c9d1e2f3a4b5c6d7e8f9a0b1c2' });
    expect(described.kind).toBe('text');
    expect(described.action).toBe(SECRET_PLACEHOLDER);
  });

  it('апдейт без текста и кнопок не теряется, а помечается как other', () => {
    expect(describeAction({})).toEqual({ kind: 'other', action: '—' });
  });

  it('deep-link у /start маскируется — payload произвольный', () => {
    const described = describeAction({ text: '/start 123456789012' });
    expect(described.kind).toBe('command');
    expect(described.action).not.toContain('123456789012');
  });
});

describe('fullName', () => {
  it('склеивает имя и фамилию', () => {
    expect(fullName('Иван', 'Петров')).toBe('Иван Петров');
  });

  it('обходится одним именем', () => {
    expect(fullName('Иван', undefined)).toBe('Иван');
  });

  it('без имени вовсе возвращает undefined, а не пустую строку', () => {
    // Пустая строка записалась бы в базу как «имя есть, но пустое».
    expect(fullName(undefined, undefined)).toBeUndefined();
  });
});

describe('ActionLogHandler', () => {
  /** Заглушка бота: запоминает единственный зарегистрированный middleware. */
  function fakeBot() {
    let middleware: (ctx: unknown, next: () => Promise<void>) => Promise<void>;
    return {
      bot: { use: (fn: typeof middleware) => (middleware = fn) } as never,
      run: (ctx: unknown, next: () => Promise<void>) => middleware(ctx, next),
    };
  }

  function ctxOf(overrides: Record<string, unknown> = {}) {
    return {
      from: { id: 777, username: 'seller', first_name: 'Иван', last_name: 'Петров' },
      chat: { id: 777 },
      botInfo: { id: 42 },
      message: { text: '/start' },
      ...overrides,
    };
  }

  async function build() {
    const record = vi.fn().mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [ActionLogHandler, { provide: ActionLogService, useValue: { record } }],
    }).compile();
    return { handler: moduleRef.get(ActionLogHandler), record };
  }

  it('записывает, КТО и ЧТО сделал', async () => {
    const { handler, record } = await build();
    const { bot, run } = fakeBot();
    handler.register(bot);

    await run(ctxOf(), async () => undefined);

    expect(record).toHaveBeenCalledTimes(1);
    const entry = record.mock.calls[0][0];
    expect(entry.telegramUserId).toBe('777');
    expect(entry.username).toBe('seller');
    expect(entry.name).toBe('Иван Петров');
    expect(entry.botId).toBe('42');
    expect(entry.kind).toBe('command');
    expect(entry.action).toBe('/start');
    expect(entry.status).toBe('ok');
  });

  it('всегда пропускает апдейт дальше — журнал ничего не блокирует', async () => {
    // Именно это разрешает ставить его ПЕРЕД гейтом доступа.
    const { handler } = await build();
    const { bot, run } = fakeBot();
    handler.register(bot);

    const next = vi.fn().mockResolvedValue(undefined);
    await run(ctxOf(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('падение обработчика записывается и пробрасывается дальше', async () => {
    // Проглоченное исключение означало бы, что пользователь не получит ответа
    // «Произошла ошибка», а telegraf.catch о сбое не узнает.
    const { handler, record } = await build();
    const { bot, run } = fakeBot();
    handler.register(bot);

    await expect(
      run(ctxOf(), async () => {
        throw new Error('Яндекс.Маркет отклонил запрос');
      }),
    ).rejects.toThrow('Яндекс.Маркет отклонил запрос');

    const entry = record.mock.calls[0][0];
    expect(entry.status).toBe('error');
    expect(entry.error).toBe('Яндекс.Маркет отклонил запрос');
  });

  it('токен из сообщения в журнал не попадает', async () => {
    const { handler, record } = await build();
    const { bot, run } = fakeBot();
    handler.register(bot);

    const token = 'ACMA5ba7c9d1e2f3a4b5c6d7e8f9a0b1c2';
    await run(ctxOf({ message: { text: token } }), async () => undefined);

    expect(record.mock.calls[0][0].action).not.toContain('ACMA');
  });

  it('апдейт без отправителя пропускается без записи', async () => {
    // «Кто» для поста в канале не определён, а журнал именно про это.
    const { handler, record } = await build();
    const { bot, run } = fakeBot();
    handler.register(bot);

    const next = vi.fn().mockResolvedValue(undefined);
    await run({ from: undefined }, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(record).not.toHaveBeenCalled();
  });

  it('сбой записи журнала не ломает обработку действия', async () => {
    // Журнал — побочная функция: недоступная Mongo не должна превращать
    // нажатие кнопки в «Произошла ошибка».
    const moduleRef = await Test.createTestingModule({
      providers: [
        ActionLogHandler,
        { provide: ActionLogService, useValue: { record: vi.fn().mockRejectedValue(new Error('mongo недоступна')) } },
      ],
    }).compile();
    const handler = moduleRef.get(ActionLogHandler);
    const { bot, run } = fakeBot();
    handler.register(bot);

    await expect(run(ctxOf(), async () => undefined)).resolves.toBeUndefined();
  });
});

describe('исходящие сообщения бота', () => {
  it('в белый список НЕ входит getUpdates', () => {
    // Через ту же воронку callApi идёт служебное. В режиме polling getUpdates
    // дёргается непрерывно, и без списка журнал состоял бы из него одного.
    expect(OUTGOING_METHODS).not.toContain('getUpdates');
    expect(OUTGOING_METHODS).not.toContain('getMe');
    expect(OUTGOING_METHODS).not.toContain('setWebhook');
  });

  it('в белый список входит то, что видит пользователь', () => {
    expect(OUTGOING_METHODS).toContain('sendMessage');
    expect(OUTGOING_METHODS).toContain('sendDocument');
    // Имя метода Bot API, а НЕ telegraf: ctx.answerCbQuery зовёт вот это.
    expect(OUTGOING_METHODS).toContain('answerCallbackQuery');
  });

  it('числа в исходящих НЕ маскируются — иначе отчёт превращается в кашу', () => {
    // Входящая маска режет 5–15 цифр как campaign_id. В отчёте столько же
    // цифр у выручки, и «Продажи: «скрыто» ₽» сделало бы журнал бесполезным.
    const report = 'Продажи: 2456985 ₽, прибыль 34340 ₽';
    expect(maskOutgoing(report)).toBe(report);
    expect(maskSecrets(report)).not.toBe(report);
  });

  it('подпись «токен:» в исходящем всё же вырезается', () => {
    expect(maskOutgoing('токен: ACMA5ba7c9d1e2f3a4b5c6')).toContain(SECRET_PLACEHOLDER);
  });

  it('описывает отправку текста', () => {
    const source = outgoingSourceOf('sendMessage', { chat_id: 777, text: 'Ваш отчёт готов' });
    expect(source.chatId).toBe(777);
    expect(describeOutgoing(source)).toEqual({ kind: 'sendMessage', action: 'Ваш отчёт готов' });
  });

  it('описывает отправку файла по имени', () => {
    const source = outgoingSourceOf('sendDocument', {
      chat_id: 777,
      document: { filename: 'otchet.xlsx' },
    });
    expect(describeOutgoing(source).action).toBe('otchet.xlsx');
  });

  it('ответ на нажатие без текста не теряется', () => {
    // Важен сам факт ответа: без него кнопка у клиента крутится 30 секунд.
    const source = outgoingSourceOf('answerCallbackQuery', { callback_query_id: '1' });
    expect(describeOutgoing(source)).toEqual({ kind: 'answerCallbackQuery', action: '—' });
  });

  it('длинный отчёт обрезается по своему, большему пределу', () => {
    // У входящих предел меньше: там команда или подпись кнопки. Отчёт на 200
    // символах терял бы всё, кроме заголовка.
    expect(MAX_OUTGOING_LENGTH).toBeGreaterThan(MAX_ACTION_LENGTH);

    const long = 'а'.repeat(MAX_OUTGOING_LENGTH + 100);
    const described = describeOutgoing(outgoingSourceOf('sendMessage', { chat_id: 1, text: long }));
    expect(described.action.length).toBe(MAX_OUTGOING_LENGTH + 1);
  });

  it('разметка СОХРАНЯЕТСЯ при записи — из неё строится модалка', () => {
    // Очистка при записи необратима: показать сообщение «как в телеграме»
    // после неё было бы не из чего. Плоский текст для строки таблицы делает
    // toPlainText на стороне отображения — см. telegram-html.test.ts.
    const described = describeOutgoing(
      outgoingSourceOf('sendMessage', { chat_id: 1, text: '🎫 <b>API-токен</b>' }),
    );
    expect(described.action).toBe('🎫 <b>API-токен</b>');
  });

  it('переносы строк сохраняются — отчёт это таблица из строк', () => {
    const report = 'Продажи: 100 ₽\nЗакуп: 70 ₽\nПрибыль: 30 ₽';
    const described = describeOutgoing(outgoingSourceOf('sendMessage', { chat_id: 1, text: report }));
    expect(described.action).toContain('\n');
    expect(described.action.split('\n')).toHaveLength(3);
  });
});
