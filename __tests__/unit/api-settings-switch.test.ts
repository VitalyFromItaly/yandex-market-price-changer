import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ApiSettingsHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/api-settings.handler';

/**
 * Смена магазина уже подключённым продавцом.
 *
 * Список магазинов берётся из КЭША в базе (`YandexMarket.stores`) — без похода в
 * API. Кэш пуст (старый аккаунт) → один раз спрашиваем API и сохраняем. Выбор
 * пишется прямо в YandexMarket через updateByTelegramUser, черновик не трогается.
 * Точка входа — публичный `startSwitch` (его зовёт bot.hears кнопки меню).
 */
describe('ApiSettingsHandler: смена магазина', () => {
  const STORES = [
    {
      campaignId: '1',
      businessId: '10',
      businessName: 'SBrand',
      storeName: 'SBrand',
      placementType: 'FBS',
    },
    {
      campaignId: '2',
      businessId: '10',
      businessName: 'SBrand',
      storeName: 'SBrand',
      placementType: 'FBY',
    },
  ];

  let listStores: ReturnType<typeof vi.fn>;
  let findByTelegramUser: ReturnType<typeof vi.fn>;
  let updateByTelegramUser: ReturnType<typeof vi.fn>;
  let saveDraftField: ReturnType<typeof vi.fn>;
  let handler: ApiSettingsHandler;

  beforeEach(() => {
    listStores = vi.fn(async () => STORES);
    // По умолчанию кэш магазинов уже в базе — смена без API.
    findByTelegramUser = vi.fn(async () => ({ token: 'ACMA:x', campaign_id: '1', stores: STORES }));
    updateByTelegramUser = vi.fn(async () => ({}));
    saveDraftField = vi.fn(async () => ({}));

    const yandexMarketService = { findByTelegramUser, updateByTelegramUser } as never;
    const accessService = { saveDraftField, findByUserAndBot: vi.fn(async () => null) } as never;
    const clients = { forTokenOnly: vi.fn(() => ({ listStores })) } as never;
    const stub = {} as never;

    handler = new ApiSettingsHandler(
      stub, // keyboard
      yandexMarketService,
      accessService,
      stub, // adminNotifier
      stub, // config
      stub, // scheduleHandler
      clients,
      stub, // reportsHandler
      { report: async () => undefined } as never, // errors
    );
  });

  /** Найти зарегистрированный bot.action для callback_data (пикер смены). */
  function actionFor(data: string): (ctx: unknown) => Promise<void> {
    const actions: { trigger: unknown; fn: (ctx: unknown) => Promise<void> }[] = [];
    handler.registerCallbacks({
      action: (t: unknown, fn: never) => actions.push({ trigger: t, fn }),
    } as never);
    const found = actions.find((a) =>
      typeof a.trigger === 'string' ? a.trigger === data : (a.trigger as RegExp).test(data),
    );
    if (!found) throw new Error(`нет обработчика для ${data}`);
    return found.fn;
  }

  function ctxWith(data?: string) {
    return {
      from: { id: 222 },
      botInfo: { id: 999 },
      callbackQuery: data === undefined ? undefined : { data },
      reply: vi.fn(async () => undefined),
      answerCbQuery: vi.fn(async () => undefined),
    };
  }

  const buttonsOf = (ctx: { reply: ReturnType<typeof vi.fn> }) => {
    const options = ctx.reply.mock.calls.at(-1)![1] as {
      reply_markup?: { inline_keyboard?: { text: string; callback_data: string }[][] };
    };
    return (options?.reply_markup?.inline_keyboard ?? []).flat();
  };

  it('из кэша БД показывает пикер со store_switch: и НЕ ходит в API', async () => {
    const ctx = ctxWith();
    await handler.startSwitch(ctx as never);

    const buttons = buttonsOf(ctx);
    expect(buttons.every((b) => b.callback_data.startsWith('store_switch:'))).toBe(true);
    expect(buttons.find((b) => b.callback_data === 'store_switch:1')!.text).toContain('✓');
    expect(buttons.some((b) => b.text.includes('FBY'))).toBe(true);
    // Кэш есть — списка у Яндекса не спрашиваем.
    expect(listStores).not.toHaveBeenCalled();
  });

  it('пустой кэш (старый аккаунт) — один раз спрашиваем API и сохраняем', async () => {
    findByTelegramUser.mockResolvedValue({ token: 'ACMA:x', campaign_id: '1' }); // stores нет
    const ctx = ctxWith();
    await handler.startSwitch(ctx as never);

    expect(listStores).toHaveBeenCalledTimes(1);
    // Сохранили список в базу, чтобы дальше не ходить в API.
    expect(updateByTelegramUser).toHaveBeenCalledWith('222', { stores: STORES });
    expect(buttonsOf(ctx).length).toBeGreaterThan(0);
  });

  it('выбор магазина пишет активный в YandexMarket и НЕ трогает черновик', async () => {
    const ctx = ctxWith('store_switch:2');
    await actionFor('store_switch:2')(ctx as never);

    expect(updateByTelegramUser).toHaveBeenCalledWith('222', {
      campaign_id: '2',
      business_id: '10',
      name: 'SBrand',
    });
    expect(saveDraftField).not.toHaveBeenCalled();
    expect(String(ctx.reply.mock.calls.at(-1)![0])).toContain('переключён');
  });

  it('подтверждение называет МОДЕЛЬ, иначе одноимённые магазины неразличимы', async () => {
    // У боевого продавца две кампании зовутся «Время с SBrand» — FBS и FBY.
    // Без модели сообщение не отвечает на вопрос, куда переключились, а от
    // модели зависит, примет ли бот прайс.
    const twins = [
      { ...STORES[0], campaignId: '10', storeName: 'Время с SBrand', placementType: 'FBS' },
      { ...STORES[1], campaignId: '20', storeName: 'Время с SBrand', placementType: 'FBY' },
    ];
    findByTelegramUser.mockResolvedValue({ token: 'ACMA:x', campaign_id: '10', stores: twins });

    const toFby = ctxWith('store_switch:20');
    await actionFor('store_switch:20')(toFby as never);
    const fbyText = String(toFby.reply.mock.calls.at(-1)![0]);

    const toFbs = ctxWith('store_switch:10');
    await actionFor('store_switch:10')(toFbs as never);
    const fbsText = String(toFbs.reply.mock.calls.at(-1)![0]);

    expect(fbyText).toContain('FBY');
    expect(fbsText).toContain('FBS');
    expect(fbyText).not.toBe(fbsText);
  });

  it('когда магазин один — переключать не на что', async () => {
    findByTelegramUser.mockResolvedValue({
      token: 'ACMA:x',
      campaign_id: '1',
      stores: [STORES[0]],
    });
    const ctx = ctxWith();
    await handler.startSwitch(ctx as never);

    expect(String(ctx.reply.mock.calls.at(-1)![0])).toContain('переключать не на что');
    expect(updateByTelegramUser).not.toHaveBeenCalled();
  });

  it('пустой список — понятная ошибка, а не тишина', async () => {
    findByTelegramUser.mockResolvedValue({ token: 'ACMA:x', campaign_id: '1' });
    listStores.mockResolvedValueOnce([]);
    const ctx = ctxWith();
    await handler.startSwitch(ctx as never);

    expect(String(ctx.reply.mock.calls.at(-1)![0])).toContain('Не удалось получить список');
  });

  /**
   * Добор кэша тем, кто подключился ДО появления кнопки.
   *
   * Проверяется не удобство, а разорванный замкнутый круг: кнопку рисуют по
   * непустому `stores`, заполняется он только при подключении токена, а ленивый
   * добор в `switchStores` живёт ЗА кнопкой. Без этого метода существующий
   * продавец с четырьмя магазинами не увидел бы её никогда — ровно это и было
   * на проде.
   */
  describe('ensureStoresCached', () => {
    const store = (extra: Record<string, unknown> = {}) => ({
      token: 'ACMA:x',
      telegramUserId: '222',
      campaign_id: '1',
      ...extra,
    });

    it('кэш пуст — спрашивает API и сохраняет', async () => {
      handler.ensureStoresCached(ctxWith() as never, store() as never);

      await vi.waitFor(() =>
        expect(updateByTelegramUser).toHaveBeenCalledWith('222', { stores: STORES }),
      );
    });

    it('пустой массив считается отсутствием кэша', async () => {
      // У mongoose массивный путь на старом документе читается как [], а не
      // undefined: проверка на undefined не сработала бы ни разу.
      handler.ensureStoresCached(ctxWith() as never, store({ stores: [] }) as never);

      await vi.waitFor(() => expect(listStores).toHaveBeenCalled());
    });

    it('кэш уже есть — в API не ходит', async () => {
      handler.ensureStoresCached(ctxWith() as never, store({ stores: STORES }) as never);

      await flush();
      expect(listStores).not.toHaveBeenCalled();
      expect(updateByTelegramUser).not.toHaveBeenCalled();
    });

    it('один магазин тоже кэшируется — иначе API опрашивался бы на каждое меню', async () => {
      listStores.mockResolvedValueOnce([STORES[0]]);
      handler.ensureStoresCached(ctxWith() as never, store() as never);

      await vi.waitFor(() =>
        expect(updateByTelegramUser).toHaveBeenCalledWith('222', { stores: [STORES[0]] }),
      );
    });

    it('без токена не делает ничего', async () => {
      handler.ensureStoresCached(ctxWith() as never, { telegramUserId: '222' } as never);
      handler.ensureStoresCached(ctxWith() as never, null);

      await flush();
      expect(listStores).not.toHaveBeenCalled();
    });

    it('сбой сети не роняет процесс и ничего не пишет', async () => {
      // Вызов идёт через `void`: отклонённый промис здесь — unhandledRejection
      // на всё приложение, а не тихая неудача фонового обновления.
      listStores.mockRejectedValueOnce(new Error('ECONNRESET'));
      handler.ensureStoresCached(ctxWith() as never, store() as never);

      await flush();
      expect(updateByTelegramUser).not.toHaveBeenCalled();
    });

    it('падение записи в базу тоже не всплывает наружу', async () => {
      updateByTelegramUser.mockRejectedValueOnce(new Error('Mongo down'));
      handler.ensureStoresCached(ctxWith() as never, store() as never);

      await flush();
      expect(listStores).toHaveBeenCalled();
    });
  });
});

/** Дать отработать фоновому промису, запущенному через `void`. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
