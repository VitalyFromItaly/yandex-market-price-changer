import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { AdminNotifierService } from '../../src/modules/telegram/bots/shared/services/admin-notifier.service';
import { PriceChangerKeyboard } from '../../src/modules/telegram/bots/price-changer-bot/price-changer.keyboard';
import { UserAccessService } from '../../src/database/services/user-access.service';
import { AppConfigService } from '../../src/config/app-config.service';

/**
 * Карточка заявки — единственное сообщение, куда попадают одновременно данные
 * пользователя (произвольный текст) и секрет продавца (токен). Оба риска
 * проверяем явно.
 */
describe('AdminNotifierService: карточка заявки', () => {
  const FULL_TOKEN = 'ACMA:bhD15nJMV71y4UZPbAFOVTZvNVGgHzkfPIH9QdWm:e0035103';

  const store = {
    campaign_id: '12345',
    business_id: '67890',
    token: FULL_TOKEN,
  } as never;

  async function build(adminIds: number[] = [111]) {
    const attachAdminCards = vi.fn(async () => undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminNotifierService,
        PriceChangerKeyboard,
        { provide: UserAccessService, useValue: { attachAdminCards } },
        {
          provide: AppConfigService,
          useValue: { telegramAdminIds: adminIds, isAdmin: (id: number) => adminIds.includes(id) },
        },
      ],
    }).compile();
    return { service: moduleRef.get(AdminNotifierService), attachAdminCards };
  }

  const access = (extra: Record<string, unknown> = {}) =>
    ({
      telegramUserId: '222',
      botId: '999',
      telegramChatId: '555',
      status: 'pending',
      adminCards: [],
      firstName: 'Вася',
      lastName: 'Пупкин',
      username: 'vasya',
      ...extra,
    }) as never;

  it('экранирует имя пользователя — иначе один символ < ломает разметку всего сообщения', async () => {
    const { service } = await build();
    const card = service.renderCard(access({ firstName: '<b>Вася', lastName: '&"Пупкин' }), store);

    expect(card).toContain('&lt;b&gt;Вася');
    expect(card).toContain('&amp;"Пупкин');
    expect(card).not.toContain('<b>Вася');
  });

  it('полный токен продавца в карточку НЕ попадает', async () => {
    const { service } = await build();
    const card = service.renderCard(access(), store);

    expect(card).not.toContain(FULL_TOKEN);
    expect(card).toContain(FULL_TOKEN.slice(0, 10));
  });

  it('при наличии ника показывает @ник — по нему администратор пишет напрямую', async () => {
    const { service } = await build();
    const card = service.renderCard(access(), store);
    expect(card).toContain('@vasya');
    expect(card).not.toContain('tg://user?id=');
  });

  it('без ника даёт ссылку tg://user?id= и сырой числовой id', async () => {
    const { service } = await build();
    const card = service.renderCard(access({ username: undefined }), store);
    expect(card).toContain('tg://user?id=222');
    expect(card).toContain('<code>222</code>');
  });

  it('пустой магазин не роняет отрисовку', async () => {
    const { service } = await build();
    expect(() => service.renderCard(access(), null)).not.toThrow();
  });

  it('кнопки — один ряд из Одобрить и Отклонить с id заявителя в callback_data', async () => {
    const { service } = await build();
    const sent: Array<Record<string, unknown>> = [];
    const ctx = {
      telegram: {
        sendMessage: async (chatId: number, text: string, opts: Record<string, unknown>) => {
          sent.push({ chatId, text, opts });
          return { chat: { id: chatId }, message_id: 42 };
        },
      },
    } as never;

    await service.sendApplication(ctx, access(), store);

    const markup = (sent[0].opts as { reply_markup: { inline_keyboard: unknown[][] } })
      .reply_markup;
    expect(markup.inline_keyboard).toHaveLength(1);
    expect(markup.inline_keyboard[0]).toHaveLength(2);
    // toMatchObject, а не toEqual: telegraf добавляет служебное поле hide.
    expect(markup.inline_keyboard[0]).toMatchObject([
      { text: '✅ Одобрить', callback_data: 'adm:ap:222' },
      { text: '⛔ Отклонить', callback_data: 'adm:rj:222' },
    ]);
  });

  it('недоступность одного администратора не срывает доставку остальным', async () => {
    // Типовая причина 403 — администратор не нажимал /start: Telegram не даёт
    // боту написать первым.
    const { service, attachAdminCards } = await build([111, 222]);
    const ctx = {
      telegram: {
        sendMessage: vi.fn(async (chatId: number) => {
          if (chatId === 111) throw new Error('403: bot was blocked by the user');
          return { chat: { id: chatId }, message_id: 7 };
        }),
      },
    } as never;

    const delivered = await service.sendApplication(ctx, access(), store);

    expect(delivered).toBe(1);
    expect(attachAdminCards).toHaveBeenCalledTimes(1);
    expect(attachAdminCards.mock.calls[0][2]).toEqual([
      { adminId: '222', chatId: 222, messageId: 7 },
    ]);
  });

  it('если карточку не получил НИКТО — возвращает 0 и ничего не сохраняет', async () => {
    const { service, attachAdminCards } = await build([111]);
    const ctx = {
      telegram: {
        sendMessage: async () => {
          throw new Error('403');
        },
      },
    } as never;

    expect(await service.sendApplication(ctx, access(), store)).toBe(0);
    expect(attachAdminCards).not.toHaveBeenCalled();
  });

  it('после решения карточки остальных админов перерисовываются без кнопок', async () => {
    const { service } = await build([111, 222]);
    const edits: Array<unknown[]> = [];
    const ctx = {
      callbackQuery: { message: { message_id: 10 } },
      editMessageText: vi.fn(async () => undefined),
      telegram: {
        editMessageText: vi.fn(async (...args: unknown[]) => {
          edits.push(args);
        }),
      },
    } as never;

    await service.finalizeCards(
      ctx,
      access({
        status: 'approved',
        decidedByUsername: 'admin',
        approvedAt: new Date('2026-07-28T12:00:00Z'),
        adminCards: [
          { adminId: '111', chatId: 111, messageId: 10 },
          { adminId: '222', chatId: 222, messageId: 20 },
        ],
      }),
      store,
    );

    // Своя карточка правится через ctx, чужая — по сохранённому message_id.
    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    expect(edits).toHaveLength(1);
    expect(edits[0][0]).toBe(222);
    expect(edits[0][1]).toBe(20);
    expect(String(edits[0][3])).toContain('Одобрено');
    // reply_markup не передан — кнопки исчезают.
    expect(edits[0][4]).not.toHaveProperty('reply_markup');
  });

  it('ошибка редактирования чужой карточки не роняет обработку решения', async () => {
    const { service } = await build([111]);
    const ctx = {
      callbackQuery: { message: { message_id: 10 } },
      editMessageText: vi.fn(async () => undefined),
      telegram: {
        editMessageText: async () => {
          throw new Error('400: message to edit not found');
        },
      },
    } as never;

    await expect(
      service.finalizeCards(
        ctx,
        access({
          status: 'rejected',
          rejectedAt: new Date(),
          adminCards: [{ adminId: '222', chatId: 222, messageId: 20 }],
        }),
        null,
      ),
    ).resolves.toBeUndefined();
  });
});
