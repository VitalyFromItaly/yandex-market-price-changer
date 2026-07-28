import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { PriceChangerComposer } from '../../src/modules/telegram/bots/price-changer-bot/price-changer.composer';
import { AccessGateHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/access-gate.handler';
import { AdminApprovalHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/admin-approval.handler';
import { StartHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/start.handler';
import { MenuCommandsHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/menu-commands.handler';
import { SlashCommandsHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/slash-commands.handler';
import { CallbackQueryHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/callback-query.handler';
import { ApiSettingsHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/api-settings.handler';
import { FallbackHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/fallback.handler';

/**
 * Порядок регистрации обработчиков telegraf — значимый инвариант, который
 * не ловится ни компилятором, ни ревью. Именно его нарушение сделало все
 * кнопки меню молча неработающими: catch-all перехватывал апдейты раньше
 * конкретных обработчиков и возвращал управление без next().
 *
 * Внешних подключений тут нет — Telegraf подменён заглушкой, Mongo и Redis
 * не нужны.
 */
describe('PriceChangerComposer: порядок регистрации', () => {
  /** Заглушка бота: пишет, какие методы telegraf были вызваны. */
  function fakeBot() {
    const calls: string[] = [];
    const noop = () => bot;
    const bot: any = {
      calls,
      start: (..._a: unknown[]) => (calls.push('start'), bot),
      hears: (..._a: unknown[]) => (calls.push('hears'), bot),
      command: (..._a: unknown[]) => (calls.push('command'), bot),
      on: (event: unknown, ..._a: unknown[]) => (
        calls.push(`on:${String(event)}`), bot
      ),
      use: noop,
      catch: noop,
      telegram: { setMyCommands: async () => undefined },
    };
    return bot;
  }

  async function buildComposer() {
    // Хендлеры подменены заглушками: проверяется ПОРЯДОК, а не их внутренности.
    const stub = (name: string, calls: string[]) => ({
      register: () => calls.push(name),
    });
    const order: string[] = [];

    const moduleRef = await Test.createTestingModule({
      providers: [
        PriceChangerComposer,
        { provide: AccessGateHandler, useValue: stub('accessGate', order) },
        { provide: AdminApprovalHandler, useValue: stub('adminCallbacks', order) },
        { provide: StartHandler, useValue: stub('start', order) },
        { provide: MenuCommandsHandler, useValue: stub('menu', order) },
        {
          provide: SlashCommandsHandler,
          useValue: {
            register: () => order.push('slash'),
            setupBotCommands: async () => order.push('setMyCommands'),
          },
        },
        { provide: CallbackQueryHandler, useValue: stub('callbacks', order) },
        { provide: ApiSettingsHandler, useValue: stub('apiSettings', order) },
        { provide: FallbackHandler, useValue: stub('fallback', order) },
      ],
    }).compile();

    return { composer: moduleRef.get(PriceChangerComposer), order };
  }

  it('catch-all зарегистрирован ПОСЛЕДНИМ', async () => {
    const { composer } = await buildComposer();
    const order = composer.registrationOrder;
    expect(order[order.length - 1]).toBe('fallback');
  });

  it('обработчик текста идёт после конкретных команд и кнопок', async () => {
    const { composer } = await buildComposer();
    const order = composer.registrationOrder;
    // apiSettings слушает любой текст — он обязан быть позже menu и slash,
    // иначе перехватит нажатия кнопок меню.
    expect(order.indexOf('apiSettings')).toBeGreaterThan(order.indexOf('menu'));
    expect(order.indexOf('apiSettings')).toBeGreaterThan(order.indexOf('slash'));
    expect(order.indexOf('fallback')).toBeGreaterThan(order.indexOf('apiSettings'));
  });

  it('compose() вызывает register в объявленном порядке', async () => {
    const { composer, order } = await buildComposer();
    await composer.compose(fakeBot());
    // setMyCommands выполняется до регистрации обработчиков
    expect(order[0]).toBe('setMyCommands');
    expect(order.slice(1)).toEqual(composer.registrationOrder);
  });

  it('ни один шаг не потерян и не продублирован', async () => {
    const { composer } = await buildComposer();
    const order = composer.registrationOrder;
    expect(new Set(order).size).toBe(order.length);
    expect(order).toEqual([
      'accessGate',
      'start',
      'menu',
      'slash',
      'adminCallbacks',
      'callbacks',
      'apiSettings',
      'fallback',
    ]);
  });

  it('гейт доступа зарегистрирован ПЕРВЫМ', async () => {
    // bot.use, поставленный после хендлеров, ничего не защищает: до него
    // апдейт просто не дойдёт — конкретный обработчик заберёт его раньше.
    const { composer } = await buildComposer();
    expect(composer.registrationOrder[0]).toBe('accessGate');
  });

  it('админские колбэки идут ДО общего обработчика callback_query', async () => {
    // Общий обработчик разбирает callback_data точным switch и на неизвестной
    // строке перезаписывает сообщение «Неизвестной командой» — карточка заявки
    // была бы затёрта вместо одобрения.
    const { composer } = await buildComposer();
    const order = composer.registrationOrder;
    expect(order.indexOf('adminCallbacks')).toBeLessThan(order.indexOf('callbacks'));
  });
});
