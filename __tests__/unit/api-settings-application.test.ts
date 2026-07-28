import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ApiSettingsHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/api-settings.handler';
import { PriceChangerKeyboard } from '../../src/modules/telegram/bots/price-changer-bot/price-changer.keyboard';
import { YandexMarketService } from '../../src/database/services/yandex-market.service';
import { UserAccessService } from '../../src/database/services/user-access.service';
import { AdminNotifierService } from '../../src/modules/telegram/bots/shared/services/admin-notifier.service';
import { AppConfigService } from '../../src/config/app-config.service';

/**
 * Подача заявки: ветка, где сходятся черновик кредов, атомарный переход статуса
 * и рассылка администраторам.
 */
describe('ApiSettingsHandler: подача заявки', () => {
  const ADMIN_ID = 111;
  const USER_ID = 222;

  const FULL = {
    campaign_id: '12345',
    business_id: '67890',
    token: 'ACMA:token:value',
  };

  async function build(opts: {
    status?: string;
    draft?: Record<string, string>;
    store?: Record<string, string> | null;
    delivered?: number;
  }) {
    const state = {
      status: opts.status ?? 'new',
      draft: { ...(opts.draft ?? {}) },
    };

    const accessService = {
      ensure: vi.fn(async () => ({ ...state, telegramUserId: String(USER_ID), botId: '999' })),
      saveDraftField: vi.fn(async (_u: string, _b: string, field: string, value: string) => {
        state.draft[field] = value;
        return { draft: { ...state.draft } };
      }),
      tryApply: vi.fn(async () => (state.status === 'new' ? { ...state, status: 'pending' } : null)),
      revertApply: vi.fn(async () => ({ ...state, status: 'new' })),
      grant: vi.fn(async () => ({ ...state, status: 'approved' })),
    };

    const yandexMarketService = {
      findByTelegramUser: vi.fn(async () => opts.store ?? null),
      updateByTelegramUser: vi.fn(async () => opts.store ?? null),
      create: vi.fn(async (data: unknown) => data),
      deleteByTelegramUser: vi.fn(async () => true),
    };

    const adminNotifier = {
      sendApplication: vi.fn(async () => opts.delivered ?? 1),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ApiSettingsHandler,
        PriceChangerKeyboard,
        { provide: YandexMarketService, useValue: yandexMarketService },
        { provide: UserAccessService, useValue: accessService },
        { provide: AdminNotifierService, useValue: adminNotifier },
        {
          provide: AppConfigService,
          useValue: { isAdmin: (id: number) => id === ADMIN_ID, telegramAdminIds: [ADMIN_ID] },
        },
      ],
    }).compile();

    return {
      handler: moduleRef.get(ApiSettingsHandler),
      accessService,
      yandexMarketService,
      adminNotifier,
    };
  }

  /** Прогоняет один текстовый апдейт через обработчик. */
  async function send(handler: ApiSettingsHandler, text: string, fromId = USER_ID) {
    let onText: (ctx: unknown) => Promise<void>;
    handler.register({
      on: (event: string, fn: never) => {
        if (event === 'text') onText = fn;
      },
    } as never);

    const ctx = {
      from: { id: fromId, username: 'vasya', first_name: 'Вася' },
      chat: { id: 555 },
      botInfo: { id: 999 },
      message: { text },
      reply: vi.fn(async () => undefined),
    };
    await onText!(ctx);
    return { ctx, reply: () => String(ctx.reply.mock.calls[0]?.[0] ?? '') };
  }

  it('первый кред сохраняется в черновик, а не падает на required-полях схемы', async () => {
    // Прежде это был create() с одним полем → ValidationError → пользователь
    // видел «Ошибка сохранения данных в базу» и не мог зарегистрироваться.
    const { handler, yandexMarketService } = await build({});
    const { reply } = await send(handler, `token: ${FULL.token}`);

    expect(yandexMarketService.create).not.toHaveBeenCalled();
    expect(reply()).toContain('Осталось заполнить');
    expect(reply()).toContain('Campaign ID');
  });

  it('третий кред подаёт заявку и создаёт магазин целиком', async () => {
    const { handler, yandexMarketService, adminNotifier, accessService } = await build({
      draft: { campaign_id: FULL.campaign_id, business_id: FULL.business_id },
    });
    const { reply } = await send(handler, `token: ${FULL.token}`);

    expect(accessService.tryApply).toHaveBeenCalledTimes(1);
    expect(yandexMarketService.create).toHaveBeenCalledWith(expect.objectContaining(FULL));
    expect(adminNotifier.sendApplication).toHaveBeenCalledTimes(1);
    expect(reply()).toContain('Заявка отправлена');
  });

  it('повторная отправка креда НЕ шлёт вторую заявку', async () => {
    // Заполненность истинна и после подачи — признаком служит переход статуса.
    const { handler, adminNotifier } = await build({
      status: 'pending',
      draft: { campaign_id: FULL.campaign_id, business_id: FULL.business_id },
    });
    const { reply } = await send(handler, `token: ${FULL.token}`);

    expect(adminNotifier.sendApplication).not.toHaveBeenCalled();
    expect(reply()).toContain('уже отправлена');
  });

  it('если карточку не получил ни один админ — статус и магазин откатываются', async () => {
    // Иначе пользователь навсегда завис бы в pending, а оставшийся магазин
    // увёл бы его следующий ввод в ветку «правка настройки».
    const { handler, accessService, yandexMarketService } = await build({
      draft: { campaign_id: FULL.campaign_id, business_id: FULL.business_id },
      delivered: 0,
    });
    const { reply } = await send(handler, `token: ${FULL.token}`);

    expect(accessService.revertApply).toHaveBeenCalledTimes(1);
    expect(yandexMarketService.deleteByTelegramUser).toHaveBeenCalledTimes(1);
    expect(reply()).toContain('Не удалось отправить заявку');
  });

  it('НЕодобренный с уже существующим магазином всё равно подаёт заявку', async () => {
    // Тупик: документ остаётся от прежней версии бота или от отката заявки.
    // Если ветку выбирать по наличию документа, ввод креда молча обновлял
    // магазин, статус навсегда оставался new и заявка не уходила никогда.
    const { handler, adminNotifier, yandexMarketService } = await build({
      status: 'new',
      draft: { campaign_id: FULL.campaign_id, business_id: FULL.business_id },
      store: { ...FULL },
    });
    const { reply } = await send(handler, `token: ${FULL.token}`);

    expect(adminNotifier.sendApplication).toHaveBeenCalledTimes(1);
    // Второй документ не заводим — unique-индекса у YandexMarket нет.
    expect(yandexMarketService.create).not.toHaveBeenCalled();
    expect(yandexMarketService.updateByTelegramUser).toHaveBeenCalled();
    expect(reply()).toContain('Заявка отправлена');
  });

  it('одобренный правит настройку без заявки администратору', async () => {
    const { handler, adminNotifier, yandexMarketService } = await build({
      status: 'approved',
      store: { ...FULL },
    });
    const { reply } = await send(handler, `campaign_id: 55555`);

    expect(adminNotifier.sendApplication).not.toHaveBeenCalled();
    expect(yandexMarketService.updateByTelegramUser).toHaveBeenCalledWith(
      String(USER_ID),
      { campaign_id: '55555' },
    );
    expect(reply()).toContain('обновлена');
  });

  it('администратор-продавец получает доступ сразу, без карточки самому себе', async () => {
    const { handler, adminNotifier, accessService } = await build({
      draft: { campaign_id: FULL.campaign_id, business_id: FULL.business_id },
    });
    const { reply } = await send(handler, `token: ${FULL.token}`, ADMIN_ID);

    expect(adminNotifier.sendApplication).not.toHaveBeenCalled();
    expect(accessService.grant).toHaveBeenCalledTimes(1);
    expect(reply()).toContain('Все настройки API заполнены');
  });

  it('голое число не выдаёт «undefined» вместо текста ответа', async () => {
    // Автоопределение распознаёт его как коэффициент, а для коэффициента
    // текста успеха не существует — раньше пользователь получал "undefined".
    const { handler } = await build({});
    const { reply } = await send(handler, '5');

    expect(reply()).not.toContain('undefined');
    expect(reply()).toContain('Коэффициент');
  });
});
