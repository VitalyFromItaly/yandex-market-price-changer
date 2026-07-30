import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { PriceChangerComposer } from '../../src/modules/telegram/bots/price-changer-bot/price-changer.composer';
import { AccessGateHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/access-gate.handler';
import { ActionLogHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/action-log.handler';
import { AdminApprovalHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/admin-approval.handler';
import { ScheduleHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/schedule.handler';
import { StartHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/start.handler';
import { MenuCommandsHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/menu-commands.handler';
import { SlashCommandsHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/slash-commands.handler';
import { CallbackQueryHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/callback-query.handler';
import { ApiSettingsHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/api-settings.handler';
import { FallbackHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/fallback.handler';
import { StockUploadHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/stock-upload.handler';
import { AdminUsersHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/admin-users.handler';
import { ReportsHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/reports.handler';

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
      on: (event: unknown, ..._a: unknown[]) => (calls.push(`on:${String(event)}`), bot),
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
        { provide: ActionLogHandler, useValue: stub('actionLog', order) },
        { provide: AccessGateHandler, useValue: stub('accessGate', order) },
        { provide: AdminApprovalHandler, useValue: stub('adminCallbacks', order) },
        { provide: ScheduleHandler, useValue: stub('scheduleCallbacks', order) },
        {
          // У отчётов только колбэки выбора периода — кнопки меню их зовут
          // напрямую, не через composer.
          provide: ReportsHandler,
          useValue: { registerCallbacks: () => order.push('reportCallbacks') },
        },
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
        {
          // У визарда ДВА входа: колбэки (до общего switch) и текст (после
          // menu/slash). Композер зовёт оба, и порядок проверяется для каждого.
          provide: ApiSettingsHandler,
          useValue: {
            register: () => order.push('apiSettings'),
            registerCallbacks: () => order.push('onboardingCallbacks'),
          },
        },
        { provide: AdminUsersHandler, useValue: stub('adminUsers', order) },
        { provide: StockUploadHandler, useValue: stub('stockUpload', order) },
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
      'actionLog',
      'accessGate',
      'start',
      'menu',
      'slash',
      'adminCallbacks',
      'adminUsers',
      'scheduleCallbacks',
      'reportCallbacks',
      'onboardingCallbacks',
      'callbacks',
      'apiSettings',
      'stockUpload',
      'fallback',
    ]);
  });

  it('гейт доступа — первый, кто может НЕ пропустить апдейт', async () => {
    // bot.use, поставленный после хендлеров, ничего не защищает: до него
    // апдейт просто не дойдёт — конкретный обработчик заберёт его раньше.
    //
    // Раньше гейт стоял буквально первым. Теперь перед ним журнал действий, и
    // это не послабление: журнал никогда не завершает апдейт сам. Инвариант
    // формулируется точнее — до гейта не должно быть НИЧЕГО, кроме шагов,
    // которые всегда зовут next().
    const { composer } = await buildComposer();
    const order = composer.registrationOrder;
    const NON_BLOCKING_BEFORE_GATE = ['actionLog'];

    expect(order.slice(0, order.indexOf('accessGate'))).toEqual(NON_BLOCKING_BEFORE_GATE);
  });

  it('журнал действий зарегистрирован ПЕРВЫМ', async () => {
    // Самое интересное в журнале — попытки заблокированных пользователей.
    // Запись, сделанная после гейта, их не увидит: гейт не зовёт next().
    const { composer } = await buildComposer();
    expect(composer.registrationOrder[0]).toBe('actionLog');
  });

  it('админские колбэки идут ДО общего обработчика callback_query', async () => {
    // Общий обработчик разбирает callback_data точным switch и на неизвестной
    // строке перезаписывает сообщение «Неизвестной командой» — карточка заявки
    // была бы затёрта вместо одобрения.
    const { composer } = await buildComposer();
    const order = composer.registrationOrder;
    expect(order.indexOf('adminCallbacks')).toBeLessThan(order.indexOf('callbacks'));
  });

  it('колбэки визарда идут ДО общего обработчика callback_query', async () => {
    // Та же ловушка, и она уже сработала: `store_pick:`, `store_pick_business:`
    // и `onboarding_help:` регистрировались вместе с текстовым обработчиком,
    // то есть ПОСЛЕ общего switch. bot.action не вызывает next(), поэтому
    // весь пикер магазина (TASK-052) и кнопка «Как получить?» (TASK-049)
    // отвечали «Неизвестная команда: store_pick:12345».
    const { composer } = await buildComposer();
    const order = composer.registrationOrder;
    expect(order.indexOf('onboardingCallbacks')).toBeLessThan(order.indexOf('callbacks'));
  });

  it('текстовый обработчик визарда регистрируется отдельно от его колбэков', async () => {
    // Разделение — не косметика: колбэки обязаны быть ДО общего switch, а
    // текст — ПОСЛЕ menu и slash. Одним методом эти два требования не
    // выполнить, и слияние обратно немедленно ломает одно из них.
    const { composer } = await buildComposer();
    const order = composer.registrationOrder;
    expect(order.indexOf('onboardingCallbacks')).toBeLessThan(order.indexOf('apiSettings'));
  });
});
