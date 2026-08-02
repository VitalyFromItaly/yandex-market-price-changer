import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ApiSettingsHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/api-settings.handler';

/**
 * Смена магазина уже подключённым продавцом.
 *
 * Ключевое отличие от онбординга: токен берётся из YandexMarket (не из
 * черновика), а выбор пишется прямо в YandexMarket через updateByTelegramUser —
 * черновик не трогается вовсе. Проверяем реальные зарегистрированные bot.action,
 * а не приватные методы.
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
    findByTelegramUser = vi.fn(async () => ({ token: 'ACMA:x', campaign_id: '1' }));
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
    );
  });

  /** Собрать зарегистрированные bot.action и найти обработчик для callback_data. */
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

  function ctxWith(data: string) {
    return {
      from: { id: 222 },
      botInfo: { id: 999 },
      callbackQuery: { data },
      reply: vi.fn(async () => undefined),
      answerCbQuery: vi.fn(async () => undefined),
    };
  }

  it('кнопка «Сменить магазин» показывает пикер со store_switch: и помечает текущий', async () => {
    const ctx = ctxWith('switch_store');
    await actionFor('switch_store')(ctx as never);

    const options = ctx.reply.mock.calls.at(-1)![1] as {
      reply_markup?: { inline_keyboard?: { text: string; callback_data: string }[][] };
    };
    const buttons = (options.reply_markup?.inline_keyboard ?? []).flat();
    // callback_data ведёт в путь СМЕНЫ, не в онбординговый store_pick:.
    expect(buttons.every((b) => b.callback_data.startsWith('store_switch:'))).toBe(true);
    // Текущая кампания (1) помечена галочкой; подпись различает FBS/FBY.
    expect(buttons.find((b) => b.callback_data === 'store_switch:1')!.text).toContain('✓');
    expect(buttons.some((b) => b.text.includes('FBY'))).toBe(true);
  });

  it('выбор магазина пишет в YandexMarket и НЕ трогает черновик', async () => {
    const ctx = ctxWith('store_switch:2');
    await actionFor('store_switch:2')(ctx as never);

    expect(updateByTelegramUser).toHaveBeenCalledWith('222', {
      campaign_id: '2',
      business_id: '10',
      name: 'SBrand',
    });
    // Онбординговый черновик не задействован.
    expect(saveDraftField).not.toHaveBeenCalled();
    expect(String(ctx.reply.mock.calls.at(-1)![0])).toContain('переключён');
  });

  it('когда магазин один — переключать не на что', async () => {
    listStores.mockResolvedValueOnce([STORES[0]]);
    const ctx = ctxWith('switch_store');
    await actionFor('switch_store')(ctx as never);

    expect(String(ctx.reply.mock.calls.at(-1)![0])).toContain('переключать не на что');
    expect(updateByTelegramUser).not.toHaveBeenCalled();
  });

  it('пустой список — понятная ошибка, а не тишина', async () => {
    listStores.mockResolvedValueOnce([]);
    const ctx = ctxWith('switch_store');
    await actionFor('switch_store')(ctx as never);

    expect(String(ctx.reply.mock.calls.at(-1)![0])).toContain('Не удалось получить список');
  });
});
