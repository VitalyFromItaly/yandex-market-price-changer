import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SellerNotificationSettingsService } from '../../src/database/services/seller-notification-settings.service';
import { SellerNotificationService } from '../../src/database/services/seller-notification.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { JOB_TYPES } from '../../src/modules/telegram';
import { SellerNotificationsProcessor } from '../../src/modules/telegram/queue/processors/seller-notifications.processor';
import {
  notifyCron,
  notifyJobId,
  parseNotifyJobId,
  pickNotificationUsers,
} from '../../src/modules/telegram/queue/services/seller-notifications-schedule';
import { SellerNotificationsScheduler } from '../../src/modules/telegram/queue/services/seller-notifications.scheduler';
import { fakeRepeatableQueue } from '../helpers/fake-repeatable-queue';
import { inMemoryModel } from '../helpers/in-memory-model';

const SELLER = '111';
const OPEN = { [FEATURE.FINANCE]: true, [FEATURE.NOTIFICATIONS]: true };
const OPEN_TG = { ...OPEN, [FEATURE.NOTIFICATIONS_TELEGRAM]: true };

describe('расписание уведомлений — чистые правила', () => {
  it('id с дефисом и только из цифр: разовая задача и чужие id не узнаются', () => {
    expect(notifyJobId(SELLER)).toBe('notify-111');
    expect(parseNotifyJobId('notify-111')).toBe('111');
    expect(parseNotifyJobId('notifynow-111')).toBeNull();
    expect(parseNotifyJobId('finance-111')).toBeNull();
    expect(parseNotifyJobId('notify-now-111')).toBeNull();
  });

  it('cron — время продавца по Москве; битое время — умолчание', () => {
    expect(notifyCron('21:30', '09:00')).toBe('30 21 * * *');
    expect(notifyCron(undefined, '09:00')).toBe('0 9 * * *');
    expect(notifyCron('99:99', '09:00')).toBe('0 9 * * *');
  });

  it('получатели — одобренные с открытой notifications (и её finance)', () => {
    const users = pickNotificationUsers([
      { telegramUserId: '1', status: 'approved', features: OPEN },
      { telegramUserId: '2', status: 'approved', features: { [FEATURE.NOTIFICATIONS]: true } },
      { telegramUserId: '3', status: 'pending', features: OPEN },
      { telegramUserId: '4', status: 'approved', features: {} },
    ]);
    expect([...users.keys()]).toEqual(['1']);
  });
});

describe('SellerNotificationsScheduler', () => {
  function build(accounts: unknown[], times: Record<string, string> = {}, initial = []) {
    const queue = fakeRepeatableQueue(initial, JOB_TYPES.CHECK_SELLER_NOTIFICATIONS);
    const scheduler = new SellerNotificationsScheduler(
      queue as never,
      { list: vi.fn(async () => accounts), findByLogin: vi.fn(async () => accounts) } as never,
      { timesFor: vi.fn(async () => new Map(Object.entries(times))) } as never,
      { report: vi.fn() } as never,
    );
    return { queue, scheduler };
  }

  it('заводит задачу на время продавца, повторная сверка ничего не меняет', async () => {
    const { queue, scheduler } = build(
      [{ telegramUserId: SELLER, status: 'approved', features: OPEN }],
      { [SELLER]: '07:15' },
    );
    expect(await scheduler.reconcile()).toEqual({ added: 1, removed: 0 });
    expect(queue.repeatables).toEqual([
      expect.objectContaining({ id: 'notify-111', cron: '15 7 * * *' }),
    ]);
    expect(queue.add.mock.calls[0][1]).toEqual({ telegramUserId: SELLER, scheduled: true });
    expect(await scheduler.reconcile()).toEqual({ added: 0, removed: 0 });
  });

  it('смена времени перезаводит задачу, закрытая фича снимает; чужие задачи не трогаются', async () => {
    const { queue, scheduler } = build(
      [{ telegramUserId: SELLER, status: 'approved', features: OPEN }],
      { [SELLER]: '10:00' },
      [
        { id: 'notify-111', cron: '0 9 * * *' },
        { id: 'notify-222', cron: '0 9 * * *' },
        { id: 'finance-111', cron: '0 3 * * *' },
      ] as never,
    );
    expect(await scheduler.reconcile()).toEqual({ added: 1, removed: 2 });
    expect(queue.repeatables.map((job) => [job.id, job.cron]).sort()).toEqual([
      ['finance-111', '0 3 * * *'],
      ['notify-111', '0 10 * * *'],
    ]);
  });

  it('разовая проверка — без повтора и с id, который сверка не узнаёт', async () => {
    const { queue, scheduler } = build([]);
    queue.add.mockResolvedValueOnce({} as never);
    await scheduler.checkNow(SELLER);
    expect(queue.add).toHaveBeenCalledWith(
      JOB_TYPES.CHECK_SELLER_NOTIFICATIONS,
      { telegramUserId: SELLER, manual: true },
      expect.objectContaining({ jobId: 'notifynow-111', removeOnComplete: true }),
    );
  });
});

describe('SellerNotificationsProcessor', () => {
  const created = [{ id: 'n1', title: 'Мало остатка: <A1>', body: 'Доступно 3 шт.' }];

  function build(options: {
    features?: Record<string, boolean> | null;
    telegram?: boolean;
    admin?: boolean;
  }) {
    const send1 = vi.fn(async () => {
      throw new Error('403: Forbidden: bot was blocked by the user');
    });
    const send2 = vi.fn(async () => ({}));
    const bots: Record<string, unknown> = {
      '1': { telegramId: 1, telegraf: { telegram: { sendMessage: send1 } } },
      '2': { telegramId: 2, telegraf: { telegram: { sendMessage: send2 } } },
    };
    const scheduler = {
      featuresFor: vi.fn(async () => (options.features === undefined ? OPEN_TG : options.features)),
      refresh: vi.fn(async () => undefined),
    };
    const notifications = {
      check: vi.fn(async () => ({ created, resolved: 0, skipped: [] })),
    };
    const feed = { markSent: vi.fn(async () => undefined) };
    const settings = { get: vi.fn(async () => ({ telegram: options.telegram ?? true })) };
    const access = {
      findByLogin: vi.fn(async () => [
        { telegramUserId: SELLER, botId: '1', status: 'approved', telegramChatId: '501' },
        { telegramUserId: SELLER, botId: '2', status: 'approved', telegramChatId: '502' },
        { telegramUserId: SELLER, botId: '3', status: 'revoked', telegramChatId: '503' },
      ]),
    };
    const registry = { findByTelegramId: (id: string) => bots[id] ?? null };
    const processor = new SellerNotificationsProcessor(
      scheduler as never,
      notifications as never,
      feed as never,
      settings as never,
      access as never,
      registry as never,
      { record: vi.fn(async () => undefined) } as never,
      { telegramAdminIds: options.admin ? [Number(SELLER)] : [] } as never,
      { report: vi.fn() } as never,
    );
    return { processor, send1, send2, scheduler, notifications, feed };
  }

  const job = (data: unknown) => ({ data }) as never;

  it('403 одного чата не мешает другому; отправленное отмечается', async () => {
    const { processor, send1, send2, feed } = build({});
    const run = await processor.handle(job({ telegramUserId: SELLER, scheduled: true }));
    expect(run).toEqual({ created: 1, resolved: 0, sent: 1 });
    expect(send1).toHaveBeenCalledTimes(1);
    expect(send2).toHaveBeenCalledWith(
      '502',
      expect.stringContaining('&lt;A1&gt;'),
      expect.anything(),
    );
    expect(feed.markSent).toHaveBeenCalledWith(SELLER, ['n1'], expect.any(Date));
  });

  it('закрытая notifications_telegram или выключенный тумблер — в CRM есть, в Telegram ничего', async () => {
    for (const options of [{ features: OPEN }, { telegram: false }]) {
      const { processor, send1, send2, notifications } = build(options);
      const run = await processor.handle(job({ telegramUserId: SELLER, scheduled: true }));
      expect(notifications.check).toHaveBeenCalled();
      expect(run.sent).toBe(0);
      expect(send1).not.toHaveBeenCalled();
      expect(send2).not.toHaveBeenCalled();
    }
  });

  it('закрытая notifications — проверки нет, расписание пересверяется', async () => {
    const { processor, notifications, scheduler } = build({ features: null });
    const run = await processor.handle(job({ telegramUserId: SELLER, scheduled: true }));
    expect(run.skipped).toBe('not-eligible');
    expect(notifications.check).not.toHaveBeenCalled();
    expect(scheduler.refresh).toHaveBeenCalled();
  });

  it('админ без строки доступа — только разовой проверкой из CRM', async () => {
    const scheduled = build({ features: null, admin: true });
    expect(
      (await scheduled.processor.handle(job({ telegramUserId: SELLER, scheduled: true }))).skipped,
    ).toBe('not-eligible');
    const manual = build({ features: null, admin: true });
    await manual.processor.handle(job({ telegramUserId: SELLER, manual: true }));
    expect(manual.notifications.check).toHaveBeenCalled();
  });
});

describe('NotificationsService.check — хранимый дедуп', () => {
  const NOW = new Date('2026-10-18T06:00:00Z');
  let available = 3;
  let inventoryFails = false;

  beforeEach(() => {
    available = 3;
    inventoryFails = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function build() {
    const feed = new SellerNotificationService(inMemoryModel() as never);
    const settingsModel = inMemoryModel();
    settingsModel.uniqueBy('telegramUserId');
    const settings = new SellerNotificationSettingsService(settingsModel as never);
    const pnl = { revenueKopecks: 10_000_000, marketplaceKopecks: -2_000_000, skus: { skus: [] } };
    const finance = {
      build: vi.fn(async () => ({ months: [{ status: 'verified' }], pnl })),
    };
    const returns = {
      build: vi.fn(async () => ({
        totals: { returnRate: 0.05, lossesKopecks: 0, soldUnits: 100 },
      })),
    };
    const inventory = {
      build: vi.fn(async () => {
        if (inventoryFails) throw new Error('Маркет не ответил');
        return {
          inventory: {
            rows: [
              {
                productId: 'p1',
                internalSku: 'A1',
                name: 'Casio A1',
                ownStock: available,
                byMarketplace: {},
                atMarketplaces: 0,
                unitsPerDay: 0.1,
                costKopecks: null,
              },
            ],
          },
          columns: [],
          problems: [],
          notes: [],
        };
      }),
    };
    const errors = { report: vi.fn() };
    const service = new NotificationsService(
      settings,
      feed,
      { findByTelegramUser: vi.fn(async () => null) } as never,
      { findByYmSkus: vi.fn(async () => []) } as never,
      finance as never,
      returns as never,
      { build: vi.fn(async () => ({ taxYear: { warnings: [] } })) } as never,
      { list: vi.fn(async () => ({ items: [], total: 0, unreviewed: 0 })) } as never,
      inventory as never,
      errors as never,
    );
    return { service, feed, settings, errors };
  }

  it('два прогона подряд — одно уведомление «мало остатка»', async () => {
    const { service, feed } = build();
    const first = await service.check(SELLER, OPEN, NOW);
    expect(first.created.map((row) => row.rule)).toContain('low_stock');
    const second = await service.check(SELLER, OPEN, NOW);
    expect(second.created).toEqual([]);
    const page = await feed.list(SELLER);
    expect(page.items.filter((row) => row.rule === 'low_stock')).toHaveLength(1);
    expect(page.unread).toBe(page.total);
  });

  it('сбой склада не снимает активные; остаток 0 — «закончился» вместо «мало»', async () => {
    const { service, feed, errors } = build();
    await service.check(SELLER, OPEN, NOW);

    inventoryFails = true;
    const failed = await service.check(SELLER, OPEN, NOW);
    expect(failed.resolved).toBe(0);
    expect(errors.report).toHaveBeenCalled();

    inventoryFails = false;
    available = 0;
    const out = await service.check(SELLER, OPEN, NOW);
    // «Нужна закупка» висит с первого прогона (своё правило, состояние не менялось) —
    // нового уведомления по ней нет.
    expect(out.created.map((row) => row.rule)).toEqual(['out_of_stock']);
    const active = await feed.listActive(SELLER);
    expect(active.map((row) => row.rule).sort()).toEqual(['out_of_stock', 'purchase_needed']);
  });

  it('выключенное правило не считается, его активное снимается', async () => {
    const { service, feed, settings } = build();
    await service.check(SELLER, OPEN, NOW);
    await settings.update(SELLER, { rules: { low_stock: { enabled: false } } });
    await service.check(SELLER, OPEN, NOW);
    expect((await feed.listActive(SELLER)).map((row) => row.rule)).not.toContain('low_stock');
  });
});
