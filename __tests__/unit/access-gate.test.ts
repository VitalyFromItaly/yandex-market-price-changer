import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { AccessGateHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/access-gate.handler';
import { UserAccessService } from '../../src/database/services/user-access.service';
import { AppConfigService } from '../../src/config/app-config.service';
import { REJECTION_COOLDOWN_MS } from '../../src/modules/telegram/bots/shared/access.domain';
import { MENU } from '../../src/modules/telegram/bots/price-changer-bot/menu.constants';

/**
 * Гейт — единственное место, где решается, пускать апдейт дальше. Прежний гейт
 * (подписка) стоял только в обработчике /start, и загрузка файла его обходила;
 * такие дыры не ловятся ни компилятором, ни ревью, поэтому проверяем каждый
 * статус отдельно.
 *
 * Внешних подключений нет: telegraf подменён заглушкой, Mongo не нужен.
 */
describe('AccessGateHandler', () => {
  const ADMIN_ID = 111;
  const USER_ID = 222;
  const BOT_ID = 999;

  let access: { status: string; rejectedAt?: Date; telegramUserId: string; botId: string };
  let ensure: ReturnType<typeof vi.fn>;
  let expireRejection: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    access = { status: 'new', telegramUserId: String(USER_ID), botId: String(BOT_ID) };
    ensure = vi.fn(async () => access);
    expireRejection = vi.fn(async () => null);
  });

  async function buildGate() {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AccessGateHandler,
        { provide: UserAccessService, useValue: { ensure, expireRejection } },
        { provide: AppConfigService, useValue: { isAdmin: (id: number) => id === ADMIN_ID } },
      ],
    }).compile();
    return moduleRef.get(AccessGateHandler);
  }

  /** Прогоняет один апдейт через middleware гейта. */
  async function run(update: {
    text?: string;
    callbackData?: string;
    fromId?: number;
    chatType?: string;
  }) {
    const gate = await buildGate();
    let middleware: (ctx: unknown, next: () => Promise<void>) => Promise<unknown>;
    gate.register({ use: (fn: never) => (middleware = fn) } as never);

    const ctx = {
      from: { id: update.fromId ?? USER_ID, username: 'vasya', first_name: 'Вася' },
      chat: { id: 555, type: update.chatType ?? 'private' },
      botInfo: { id: BOT_ID },
      message: update.text === undefined ? undefined : { text: update.text },
      callbackQuery:
        update.callbackData === undefined ? undefined : { data: update.callbackData },
      reply: vi.fn(async () => undefined),
      answerCbQuery: vi.fn(async () => undefined),
    };
    const next = vi.fn(async () => undefined);

    await middleware!(ctx, next);
    return { ctx, next };
  }

  it('администратор проходит всегда и записи доступа не получает', async () => {
    // Иначе администратор-продавец прислал бы заявку сам себе.
    const { next } = await run({ text: 'что угодно', fromId: ADMIN_ID });
    expect(next).toHaveBeenCalled();
    expect(ensure).not.toHaveBeenCalled();
  });

  it.each(['new', 'pending', 'rejected', 'approved'])(
    '/start проходит при статусе %s',
    async (status) => {
      access.status = status;
      access.rejectedAt = new Date();
      const { next } = await run({ text: '/start' });
      expect(next).toHaveBeenCalled();
    },
  );

  it('/start@ИмяБота с payload — тоже /start', async () => {
    access.status = 'pending';
    const { next } = await run({ text: '/start@YandexMarketBot deep_link' });
    expect(next).toHaveBeenCalled();
  });

  it('новый пользователь может вводить креды — это и есть регистрация', async () => {
    const { next, ctx } = await run({ text: 'campaign_id: 12345' });
    expect(next).toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it('новому пользователю кнопки меню недоступны', async () => {
    const { next, ctx } = await run({ text: MENU.PROFILE });
    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledTimes(1);
  });

  it('pending блокируется одним понятным сообщением', async () => {
    access.status = 'pending';
    const { next, ctx } = await run({ text: 'campaign_id: 12345' });
    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(String(ctx.reply.mock.calls[0][0])).toContain('рассмотрении');
  });

  it('отклонённый не может вводить креды в течение суток', async () => {
    access.status = 'rejected';
    access.rejectedAt = new Date(Date.now() - 2 * 3600_000);
    const { next, ctx } = await run({ text: 'campaign_id: 12345' });
    expect(next).not.toHaveBeenCalled();
    expect(expireRejection).not.toHaveBeenCalled();
    expect(String(ctx.reply.mock.calls[0][0])).toContain('отклонена');
  });

  it('через сутки отказ снимается лениво и ввод кредов снова доступен', async () => {
    access.status = 'rejected';
    access.rejectedAt = new Date(Date.now() - REJECTION_COOLDOWN_MS - 3600_000);
    expireRejection.mockResolvedValueOnce({ ...access, status: 'new', rejectedAt: undefined });

    const { next } = await run({ text: 'campaign_id: 12345' });
    expect(expireRejection).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalled();
  });

  it('cutoff при снятии отказа отсчитывается ровно на сутки назад', async () => {
    access.status = 'rejected';
    access.rejectedAt = new Date(Date.now() - REJECTION_COOLDOWN_MS - 3600_000);
    await run({ text: 'привет' });

    const cutoff = expireRejection.mock.calls[0][2] as Date;
    expect(Math.abs(Date.now() - cutoff.getTime() - REJECTION_COOLDOWN_MS)).toBeLessThan(5000);
  });

  it('заблокированная inline-кнопка получает ответ и НЕ идёт дальше', async () => {
    // Без answerCbQuery кнопка у клиента крутится ~30 секунд, а с next()
    // default-ветка общего обработчика затрёт сообщение «Неизвестной командой».
    access.status = 'pending';
    const { next, ctx } = await run({ callbackData: 'check_settings' });
    expect(next).not.toHaveBeenCalled();
    expect(ctx.answerCbQuery).toHaveBeenCalledTimes(1);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it('подсказки по настройке доступны новому пользователю', async () => {
    const { next } = await run({ callbackData: 'settings_api' });
    expect(next).toHaveBeenCalled();
  });

  it('в групповом чате гейт выходит молча и не заводит запись на группу', async () => {
    const { next, ctx } = await run({ text: 'привет', chatType: 'group' });
    expect(next).not.toHaveBeenCalled();
    expect(ensure).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it('одобренному доступно всё', async () => {
    access.status = 'approved';
    for (const update of [{ text: MENU.PROFILE }, { callbackData: 'check_settings' }, {}]) {
      const { next } = await run(update);
      expect(next).toHaveBeenCalled();
    }
  });
});
