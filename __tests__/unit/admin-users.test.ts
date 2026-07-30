import { describe, it, expect, vi } from 'vitest';

import {
  AdminUsersHandler,
  REVOKE_PREFIX,
  REVOKE_CONFIRM_PREFIX,
} from '../../src/modules/telegram/bots/price-changer-bot/handlers/admin-users.handler';
import {
  MENU,
  MENU_LAYOUT,
  withAdminRow,
} from '../../src/modules/telegram/bots/price-changer-bot/menu.constants';

const ADMIN_ID = 111;
const STRANGER_ID = 222;

function build(overrides: { users?: unknown[]; revoked?: unknown } = {}) {
  const accessService = {
    countByStatus: vi.fn(async () => ({ approved: 2, pending: 1, rejected: 3 })),
    listByBot: vi.fn(async () => overrides.users ?? []),
    findByUserAndBot: vi.fn(async () => ({ telegramUserId: '900', username: 'seller' })),
    revoke: vi.fn(async () => overrides.revoked ?? null),
  };
  const yandexMarketService = { isConfigured: vi.fn(async () => true) };
  const config = { isAdmin: (id: number) => id === ADMIN_ID };

  const handler = new AdminUsersHandler(
    accessService as never,
    yandexMarketService as never,
    config as never,
  );

  return { handler, accessService, yandexMarketService };
}

function fakeCtx(fromId: number, data?: string) {
  const replies: string[] = [];
  return {
    replies,
    from: { id: fromId, username: 'admin' },
    botInfo: { id: 42 },
    callbackQuery: data ? { data } : undefined,
    reply: vi.fn(async (text: string) => void replies.push(text)),
    answerCbQuery: vi.fn(async () => undefined),
    editMessageText: vi.fn(async (text: string) => void replies.push(text)),
    telegram: { sendMessage: vi.fn(async () => undefined) },
  };
}

describe('AdminUsersHandler: права', () => {
  it('кнопка «Пользователи» есть только в админской раскладке', () => {
    const plain = MENU_LAYOUT.flatMap((r) => [...r]);
    expect(plain).not.toContain(MENU.USERS);

    const admin = withAdminRow(MENU_LAYOUT.map((r) => [...r])).flat();
    expect(admin).toContain(MENU.USERS);
  });

  it('isAdmin отделяет администратора от постороннего', () => {
    const { handler } = build();
    expect(handler.isAdmin(ADMIN_ID)).toBe(true);
    expect(handler.isAdmin(STRANGER_ID)).toBe(false);
  });

  it('посторонний не получает список, даже вызвав обработчик напрямую', async () => {
    // Скрытая кнопка — это не защита: callback_data можно послать вручную.
    const { handler, accessService } = build();
    const bot: Record<string, (...a: never[]) => unknown> = {};
    const capture = (name: string) => (_pattern: unknown, fn: unknown) => {
      bot[name] = fn as never;
      return bot;
    };

    handler.register({
      command: (_c: string, fn: unknown) => ((bot.command = fn as never), bot),
      action: capture('action'),
    } as never);

    const ctx = fakeCtx(STRANGER_ID);
    await (bot.command as (c: unknown) => Promise<void>)(ctx);

    expect(accessService.listByBot).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});

describe('AdminUsersHandler: список', () => {
  it('пустой список сообщает об этом, а не молчит', async () => {
    const { handler } = build({ users: [] });
    const ctx = fakeCtx(ADMIN_ID);
    // countByStatus вернёт ненулевые, но список пуст — берём согласованный случай
    (handler as never as { accessService: { countByStatus: unknown } }).accessService = {
      countByStatus: async () => ({}),
      listByBot: async () => [],
    } as never;

    await handler.sendList(ctx as never);
    expect(ctx.replies.join('\n')).toContain('Пока никто не регистрировался');
  });

  it('ник отдаётся ссылкой t.me — чтобы админ написал напрямую', async () => {
    const { handler } = build({
      users: [
        {
          telegramUserId: '900',
          status: 'approved',
          username: 'seller',
          firstName: 'Иван',
          approvedAt: new Date('2026-07-01'),
        },
      ],
    });
    const ctx = fakeCtx(ADMIN_ID);
    await handler.sendList(ctx as never);

    const text = ctx.replies.join('\n');
    expect(text).toContain('href="https://t.me/seller"');
    expect(text).toContain('@seller');
  });

  it('данные пользователя экранируются', async () => {
    const { handler } = build({
      users: [
        {
          telegramUserId: '900',
          status: 'approved',
          username: 'a<b',
          firstName: 'И<ван>',
        },
      ],
    });
    const ctx = fakeCtx(ADMIN_ID);
    await handler.sendList(ctx as never);

    const text = ctx.replies.join('\n');
    expect(text).toContain('&lt;');
    expect(text).not.toMatch(/>И<ван>/);
  });

  it('кнопки отзыва — только для тех, у кого доступ есть', async () => {
    const { handler } = build({
      users: [
        { telegramUserId: '1', status: 'approved', username: 'a' },
        { telegramUserId: '2', status: 'pending', username: 'b' },
        { telegramUserId: '3', status: 'rejected', username: 'c' },
      ],
    });
    const ctx = fakeCtx(ADMIN_ID);
    await handler.sendList(ctx as never);

    const withButtons = ctx.reply.mock.calls.find(
      (c) => (c[1] as { reply_markup?: unknown })?.reply_markup,
    );
    const rows = (withButtons![1] as { reply_markup: { inline_keyboard: unknown[][] } })
      .reply_markup.inline_keyboard;

    expect(rows).toHaveLength(1);
    expect((rows[0][0] as { callback_data: string }).callback_data).toBe(`${REVOKE_PREFIX}1`);
  });
});

describe('AdminUsersHandler: отзыв доступа', () => {
  function wire(handler: AdminUsersHandler) {
    const actions: Array<{ pattern: RegExp; fn: (ctx: unknown) => Promise<void> }> = [];
    handler.register({
      command: () => undefined,
      action: (pattern: RegExp, fn: (ctx: unknown) => Promise<void>) => {
        actions.push({ pattern, fn });
      },
    } as never);
    return {
      ask: actions[0].fn,
      confirm: actions[1].fn,
    };
  }

  it('первое нажатие только спрашивает подтверждение, ничего не меняя', async () => {
    const { handler, accessService } = build();
    const { ask } = wire(handler);
    const ctx = fakeCtx(ADMIN_ID, `${REVOKE_PREFIX}900`);

    await ask(ctx);

    expect(accessService.revoke).not.toHaveBeenCalled();
    expect(ctx.replies.join('\n')).toContain('Закрыть доступ');
  });

  it('подтверждение отзывает доступ и уведомляет пользователя', async () => {
    const { handler, accessService } = build({
      revoked: { telegramUserId: '900', telegramChatId: '555', username: 'seller' },
    });
    const { confirm } = wire(handler);
    const ctx = fakeCtx(ADMIN_ID, `${REVOKE_CONFIRM_PREFIX}900`);

    await confirm(ctx);

    expect(accessService.revoke).toHaveBeenCalledWith('900', '42', {
      id: '111',
      username: 'admin',
    });
    expect(ctx.telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('закрыт'));
  });

  it('повторный отзыв безопасен: revoke вернул null — сообщаем и не падаем', async () => {
    // Фильтр status:'approved' не совпал — другой админ успел раньше.
    const { handler } = build({ revoked: null });
    const { confirm } = wire(handler);
    const ctx = fakeCtx(ADMIN_ID, `${REVOKE_CONFIRM_PREFIX}900`);

    await confirm(ctx);

    expect(ctx.replies.join('\n')).toContain('уже был закрыт');
  });

  it('заблокировавший бота пользователь не срывает отзыв', async () => {
    // Статус уже изменён — неудача уведомления не должна его откатывать.
    const { handler } = build({
      revoked: { telegramUserId: '900', telegramChatId: '555', username: 'seller' },
    });
    const { confirm } = wire(handler);
    const ctx = fakeCtx(ADMIN_ID, `${REVOKE_CONFIRM_PREFIX}900`);
    ctx.telegram.sendMessage = vi.fn(async () => {
      throw new Error('bot was blocked by the user');
    });

    await expect(confirm(ctx)).resolves.toBeUndefined();
  });

  it('посторонний не может отозвать доступ', async () => {
    const { handler, accessService } = build();
    const { confirm } = wire(handler);
    const ctx = fakeCtx(STRANGER_ID, `${REVOKE_CONFIRM_PREFIX}900`);

    await confirm(ctx);

    expect(accessService.revoke).not.toHaveBeenCalled();
  });
});
