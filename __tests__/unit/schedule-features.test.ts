import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';

import { ReportScheduleService } from '../../src/database/services/report-schedule.service';
import { UserAccessService } from '../../src/database/services/user-access.service';
import { YandexMarketService } from '../../src/database/services/yandex-market.service';
import { ErrorReporter } from '../../src/modules/errors/error-reporter.service';
import { ScheduleHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/schedule.handler';
import { PriceChangerKeyboard } from '../../src/modules/telegram/bots/price-changer-bot/price-changer.keyboard';
import { BotRegistry } from '../../src/modules/telegram/bots/bot-registry.service';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { ReportsProcessor } from '../../src/modules/telegram/queue/processors/reports.processor';
import { SellerNotificationSettingsService } from '../../src/database/services/seller-notification-settings.service';
import { ReportSchedulerService } from '../../src/modules/telegram/queue/services/report-scheduler.service';
import { SellerNotificationsScheduler } from '../../src/modules/telegram/queue/services/seller-notifications.scheduler';
import { OrderReportsService } from '../../src/modules/yandex/reports/order-reports.service';
import { ProfitService } from '../../src/modules/yandex/reports/profit.service';
import { FinanceService } from '../../src/modules/finance/finance.service';
import { REPORT } from '../../src/modules/yandex/reports/report-status-map';

const STORE = { token: 'ACMA:x', campaign_id: '1', business_id: '2' };

/**
 * Рассылка и пофичный доступ.
 *
 * Два места, где закрытая возможность обязана не сработать: раздел настройки
 * рассылки (не предлагать заводить расписание для закрытого отчёта) и сам
 * ежедневный дайджест (не слать по уже заведённому). Расхождение между кнопкой
 * и рассылкой — самый известный источник жалоб в этом проекте.
 */
describe('Раздел рассылки уважает закрытые возможности', () => {
  async function buildHandler(features?: Record<string, boolean>) {
    const schedules = {
      listForUser: vi.fn(async () => []),
      findOne: vi.fn(async () => null),
      setEnabled: vi.fn(async () => ({ time: '09:00' })),
      setTime: vi.fn(async () => ({ ok: true, schedule: { enabled: false, time: '09:00' } })),
    };
    const access = {
      findByUserAndBot: vi.fn(async () => ({ features })),
      setPendingSchedule: vi.fn(async () => null),
    };
    const notifySettings = {
      get: vi.fn(async () => ({ telegram: true, time: '09:00' })),
      update: vi.fn(async () => ({ telegram: true, time: '09:00' })),
    };
    const notifyScheduler = { refresh: vi.fn(async () => undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ScheduleHandler,
        PriceChangerKeyboard,
        { provide: ReportScheduleService, useValue: schedules },
        { provide: ReportSchedulerService, useValue: { schedule: vi.fn(), unschedule: vi.fn() } },
        { provide: SellerNotificationSettingsService, useValue: notifySettings },
        { provide: SellerNotificationsScheduler, useValue: notifyScheduler },
        { provide: UserAccessService, useValue: access },
      ],
    }).compile();

    return {
      handler: moduleRef.get(ScheduleHandler),
      schedules,
      access,
      notifySettings,
      notifyScheduler,
    };
  }

  function fakeCtx() {
    return {
      from: { id: 222 },
      botInfo: { id: 999 },
      reply: vi.fn(async () => undefined),
      lastKeyboardText(): string {
        const options = this.reply.mock.calls.at(-1)?.[1] as
          | { reply_markup?: { inline_keyboard?: { text: string }[][] } }
          | undefined;
        return JSON.stringify(options?.reply_markup?.inline_keyboard ?? []);
      },
    };
  }

  it('без ограничений в разделе все пять отчётов', async () => {
    const { handler } = await buildHandler();
    const ctx = fakeCtx();

    await handler.showMenu(ctx as never);

    const buttons = ctx.lastKeyboardText();
    expect(buttons).toContain('Уехало клиенту');
    expect(buttons).toContain('Прибыль');
  });

  it('закрытый отчёт в разделе рассылки не предлагается', async () => {
    // Расписание для закрытого отчёта — расписание, которое никогда не
    // сработает.
    const { handler } = await buildHandler({ [FEATURE.REPORT_PROFIT]: false });
    const ctx = fakeCtx();

    await handler.showMenu(ctx as never);

    const buttons = ctx.lastKeyboardText();
    expect(buttons).not.toContain('Прибыль');
    expect(buttons).toContain('Уехало клиенту');
  });

  it('ответ временем на закрытый отчёт не заводит расписание', async () => {
    // Вопрос про время приходит обычным текстом, то есть мимо гейта: доступ
    // могли закрыть, пока вопрос оставался открытым.
    const { handler, schedules, access } = await buildHandler({ [FEATURE.REPORT_PROFIT]: false });
    access.findByUserAndBot.mockResolvedValue({
      features: { [FEATURE.REPORT_PROFIT]: false },
      pendingScheduleReport: REPORT.PROFIT,
    } as never);
    const ctx = fakeCtx();

    const handled = await handler.handlePendingTime(ctx as never, '09:00');

    expect(handled).toBe(true);
    expect(schedules.setTime).not.toHaveBeenCalled();
    // Вопрос закрывается, иначе бот отвечал бы отказом на каждое сообщение.
    expect(access.setPendingSchedule).toHaveBeenCalledWith('222', '999', null);
  });
  it('ряд «🔔 Уведомления» — только при открытой notifications_telegram', async () => {
    const closed = await buildHandler({ [FEATURE.FINANCE]: true, [FEATURE.NOTIFICATIONS]: true });
    const ctxClosed = fakeCtx();
    await closed.handler.showMenu(ctxClosed as never);
    expect(ctxClosed.lastKeyboardText()).not.toContain('Уведомления');

    const open = await buildHandler({
      [FEATURE.FINANCE]: true,
      [FEATURE.NOTIFICATIONS]: true,
      [FEATURE.NOTIFICATIONS_TELEGRAM]: true,
    });
    const ctxOpen = fakeCtx();
    await open.handler.showMenu(ctxOpen as never);
    expect(ctxOpen.lastKeyboardText()).toContain('✅ 🔔 Уведомления');
    expect(ctxOpen.lastKeyboardText()).toContain('ntf:time');
  });

  it('время уведомлений — тем же разбором, с пересверкой расписания; закрытая фича — отказ', async () => {
    const features = {
      [FEATURE.FINANCE]: true,
      [FEATURE.NOTIFICATIONS]: true,
      [FEATURE.NOTIFICATIONS_TELEGRAM]: true,
    };
    const { handler, access, notifySettings, notifyScheduler } = await buildHandler(features);
    access.findByUserAndBot.mockResolvedValue({
      features,
      pendingScheduleReport: 'notifications',
    } as never);
    const ctx = fakeCtx();

    expect(await handler.handlePendingTime(ctx as never, '25:00')).toBe(true);
    expect(notifySettings.update).not.toHaveBeenCalled();

    expect(await handler.handlePendingTime(ctx as never, '7.30')).toBe(true);
    expect(notifySettings.update).toHaveBeenCalledWith('222', { time: '07:30' });
    expect(notifyScheduler.refresh).toHaveBeenCalled();
    expect(access.setPendingSchedule).toHaveBeenCalledWith('222', '999', null);

    const closed = await buildHandler({ [FEATURE.FINANCE]: true });
    closed.access.findByUserAndBot.mockResolvedValue({
      features: { [FEATURE.FINANCE]: true },
      pendingScheduleReport: 'notifications',
    } as never);
    expect(await closed.handler.handlePendingTime(ctx as never, '10:00')).toBe(true);
    expect(closed.notifySettings.update).not.toHaveBeenCalled();
  });
});

describe('Ежедневный дайджест уважает закрытые возможности', () => {
  async function buildProcessor(account: Record<string, unknown> | null) {
    const sendMessage = vi.fn(async () => undefined);
    const reports = {
      build: vi.fn(async () => ({
        key: REPORT.REDEEMED,
        title: 'Выкуплено',
        count: 0,
        totals: { items: 0, withDelivery: 0 },
        orders: [],
      })),
      exportInTransit: vi.fn(async () => ({ empty: true, message: 'нет данных' })),
    };
    const profit = {
      build: vi.fn(async () => ({
        period: { key: 'month' },
        pricesUpdatedAt: null,
        totals: {
          revenue: 10000,
          commission: 2300,
          tax: 700,
          purchase: 5000,
          promo: 0,
          net: 2000,
          orders: 1,
          unconfirmed: { confirmed: true, orders: 0, revenueKopecks: 0, skus: [] },
          returnedOrders: 0,
          returnedRevenue: 0,
          rates: { commissionPercent: 23, taxPercent: 7, discountPercent: 10 },
        },
      })),
    };
    const finance = {
      actualNet: vi.fn(async () => ({ state: 'preliminary', reason: 'месяц не закрыт' })),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReportsProcessor,
        {
          provide: BotRegistry,
          useValue: { findByTelegramId: () => ({ telegraf: { telegram: { sendMessage } } }) },
        },
        { provide: UserAccessService, useValue: { findByUserAndBot: async () => account } },
        { provide: YandexMarketService, useValue: { findByTelegramUser: async () => STORE } },
        { provide: OrderReportsService, useValue: reports },
        { provide: ProfitService, useValue: profit },
        { provide: FinanceService, useValue: finance },
        { provide: ReportScheduleService, useValue: { findOne: async () => null } },
        { provide: ErrorReporter, useValue: { report: async () => undefined } },
      ],
    }).compile();

    return { processor: moduleRef.get(ReportsProcessor), reports, sendMessage, profit, finance };
  }

  const job = (reportKey: string) => ({
    data: { telegramUserId: '222', botId: '999', reportKey },
  });

  it('открытый отчёт уходит как раньше', async () => {
    const { processor, reports, sendMessage } = await buildProcessor({
      status: 'approved',
      telegramChatId: '555',
      features: {},
    });

    await processor.send(job(REPORT.REDEEMED) as never);

    expect(reports.build).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalled();
  });

  it('«Прибыль» рассылки ветвится как кнопка: profit_actual — пометка, без него — прежний текст', async () => {
    const open = await buildProcessor({
      status: 'approved',
      telegramChatId: '555',
      features: { finance: true, profit_actual: true },
    });
    await open.processor.send(job(REPORT.PROFIT) as never);
    expect(open.finance.actualNet).toHaveBeenCalledWith('222', expect.anything(), expect.any(Date));
    expect(String(open.sendMessage.mock.calls[0][1])).toContain('· предварительно');

    const closed = await buildProcessor({
      status: 'approved',
      telegramChatId: '555',
      features: {},
    });
    await closed.processor.send(job(REPORT.PROFIT) as never);
    expect(closed.finance.actualNet).not.toHaveBeenCalled();
    expect(String(closed.sendMessage.mock.calls[0][1])).not.toContain('предварительно');
  });

  it('закрытый отчёт не собирается и не уходит', async () => {
    // Расписание остаётся в Redis после закрытия возможности; без этой
    // проверки закрытый отчёт продолжал бы приходить каждый день.
    const { processor, reports, sendMessage } = await buildProcessor({
      status: 'approved',
      telegramChatId: '555',
      features: { [FEATURE.REPORT_REDEEMED]: false },
    });

    await processor.send(job(REPORT.REDEEMED) as never);

    expect(reports.build).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('закрытая рассылка останавливает все отчёты сразу', async () => {
    const { processor, sendMessage } = await buildProcessor({
      status: 'approved',
      telegramChatId: '555',
      features: { [FEATURE.SCHEDULE]: false },
    });

    await processor.send(job(REPORT.REDEEMED) as never);

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('отозванный доступ по-прежнему останавливает рассылку', async () => {
    const { processor, sendMessage } = await buildProcessor({
      status: 'rejected',
      telegramChatId: '555',
    });

    await processor.send(job(REPORT.REDEEMED) as never);

    expect(sendMessage).not.toHaveBeenCalled();
  });
});
