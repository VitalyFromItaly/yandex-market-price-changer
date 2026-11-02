import { describe, expect, it, vi } from 'vitest';

import { toCrmPushEvents } from '../../src/modules/crm/stock-push/crm-stock-push.domain';
import { MarketplaceEventsService } from '../../src/modules/marketplace-events/marketplace-events.service';
import {
  STOCK_PUSH_EVENT_WINDOW_MS,
  eventWindowOf,
  isEventSourceAllowed,
  parseMarketplaceEvent,
  webhookUrlOf,
} from '../../src/modules/stock-push/marketplace-events';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import {
  pushEventJobId,
  parsePushJobId,
} from '../../src/modules/telegram/queue/services/stock-push-schedule';
import { StockPushScheduler } from '../../src/modules/telegram/queue/services/stock-push.scheduler';
import { JOB_TYPES } from '../../src/modules/telegram/index';

/**
 * Синхронизация по уведомлению площадки о заказе (stock_push_on_marketplace_event):
 * разбор ЯМ/Ozon, ответ площадке, склейка в один проход, права.
 */

const SECRET = 'a'.repeat(48);

describe('parseMarketplaceEvent', () => {
  it('ЯМ: PING, заказ создан/отменён — склад, остальное — без прохода', () => {
    expect(parseMarketplaceEvent('ym', { notificationType: 'PING', time: 'x' })).toEqual({
      kind: 'ping',
    });
    expect(
      parseMarketplaceEvent('ym', {
        notificationType: 'ORDER_CREATED',
        campaignId: 42,
        orderId: 1,
      }),
    ).toEqual({ kind: 'stock', campaignId: '42' });
    expect(
      parseMarketplaceEvent('ym', { notificationType: 'ORDER_CANCELLED', campaignId: '7' }),
    ).toEqual({
      kind: 'stock',
      campaignId: '7',
    });
    expect(
      parseMarketplaceEvent('ym', { notificationType: 'ORDER_STATUS_UPDATED', campaignId: 1 }),
    ).toEqual({
      kind: 'ignored',
      type: 'ORDER_STATUS_UPDATED',
    });
    expect(parseMarketplaceEvent('ym', { notificationType: 'ORDER_CREATED' })).toEqual({
      kind: 'invalid',
    });
    expect(parseMarketplaceEvent('ym', 'garbage')).toEqual({ kind: 'invalid' });
  });

  it('Ozon: TYPE_PING, новое отправление/отмена — склад', () => {
    expect(parseMarketplaceEvent('ozon', { message_type: 'TYPE_PING' })).toEqual({ kind: 'ping' });
    expect(
      parseMarketplaceEvent('ozon', {
        message_type: 'TYPE_NEW_POSTING',
        seller_id: 15,
        posting_number: 'x',
      }),
    ).toEqual({ kind: 'stock', sellerId: '15' });
    expect(parseMarketplaceEvent('ozon', { message_type: 'TYPE_POSTING_CANCELLED' })).toEqual({
      kind: 'stock',
    });
    expect(parseMarketplaceEvent('ozon', { message_type: 'TYPE_NEW_MESSAGE' })).toEqual({
      kind: 'ignored',
      type: 'TYPE_NEW_MESSAGE',
    });
    expect(parseMarketplaceEvent('ozon', {})).toEqual({ kind: 'invalid' });
  });
});

describe('окно склейки и адрес', () => {
  it('события одного окна — один id задачи, проход в конце окна', () => {
    const start = 100 * STOCK_PUSH_EVENT_WINDOW_MS;
    expect(eventWindowOf(start)).toEqual({ window: 100, delayMs: STOCK_PUSH_EVENT_WINDOW_MS });
    expect(eventWindowOf(start + 1000)).toEqual({
      window: 100,
      delayMs: STOCK_PUSH_EVENT_WINDOW_MS - 1000,
    });
    expect(eventWindowOf(start + STOCK_PUSH_EVENT_WINDOW_MS).window).toBe(101);
    // Сверка расписания такую задачу не узнаёт — не снимет её как лишнюю.
    expect(parsePushJobId(pushEventJobId('42', 100))).toBeNull();
    expect(pushEventJobId('42', 100)).not.toContain(':');
  });

  it('адрес — только при заданном PUBLIC_BASE_URL', () => {
    expect(webhookUrlOf('https://bot.ru', 'ozon', SECRET)).toBe(
      `https://bot.ru/api/webhooks/ozon/${SECRET}`,
    );
    expect(webhookUrlOf(null, 'ym', SECRET)).toBeNull();
  });

  it('вид CRM: шаги и последнее событие по площадке; без адреса — причина', () => {
    const view = toCrmPushEvents('https://bot.ru', SECRET, {
      ozon: new Date('2026-11-02T10:00:00Z'),
    });
    expect(view.unavailable).toBeNull();
    expect(view.targets.map((t) => [t.marketplace, t.lastEventAt])).toEqual([
      ['ym', null],
      ['ozon', '2026-11-02T10:00:00.000Z'],
    ]);
    expect(view.targets[0].url).toBe(`https://bot.ru/api/webhooks/ym/${SECRET}`);
    expect(toCrmPushEvents(null, SECRET, {}).unavailable).not.toBeNull();
  });
});

describe('MarketplaceEventsService.receive', () => {
  const now = new Date('2026-11-02T10:00:30Z');

  const YM_IP = '5.45.207.10';
  const OZON_IP = '195.34.21.7';

  function service({ owner = true, features = true, campaigns = ['42'], ipCheck = true } = {}) {
    const settings = {
      findBySecret: vi.fn(async () => (owner ? { telegramUserId: '1', lastEventAt: {} } : null)),
      markEvent: vi.fn(async () => undefined),
    };
    const stores = {
      findByTelegramUser: vi.fn(async () => ({
        campaign_id: campaigns[0],
        stores: campaigns.map((campaignId) => ({ campaignId })),
      })),
    };
    const scheduler = {
      featuresAfterEvent: vi.fn(async () => (features ? {} : null)),
      sendAfterEvent: vi.fn(async () => undefined),
    };
    const errors = { report: vi.fn() };
    const config = { marketplaceWebhookIpCheck: ipCheck };
    const s = new MarketplaceEventsService(
      settings as never,
      stores as never,
      scheduler as never,
      errors as never,
      config as never,
    );
    return { s, settings, scheduler, errors };
  }

  it('PING — 200 с {version, name, time}, проход не ставится', async () => {
    const { s, scheduler } = service();
    const reply = await s.receive('ym', SECRET, { notificationType: 'PING' }, YM_IP, now);
    expect(reply).toEqual({
      status: 200,
      body: { version: expect.any(String), name: expect.any(String), time: now.toISOString() },
    });
    expect(scheduler.sendAfterEvent).not.toHaveBeenCalled();
  });

  it('чужой адрес или площадка — 404; не уведомление — 400', async () => {
    expect(
      (await service({ owner: false }).s.receive('ym', SECRET, { notificationType: 'PING' }, YM_IP))
        .status,
    ).toBe(404);
    expect((await service().s.receive('wb', SECRET, {}, YM_IP)).status).toBe(404);
    expect((await service().s.receive('ozon', SECRET, { foo: 1 }, OZON_IP)).status).toBe(400);
  });

  it('заказ своего магазина — отметка и проход', async () => {
    const { s, settings, scheduler } = service();
    const reply = await s.receive(
      'ym',
      SECRET,
      { notificationType: 'ORDER_CREATED', campaignId: 42 },
      YM_IP,
      now,
    );
    expect(reply.status).toBe(200);
    expect(settings.markEvent).toHaveBeenCalledWith('1', 'ym', now);
    expect(scheduler.sendAfterEvent).toHaveBeenCalledWith('1', now.getTime());
  });

  it('чужой магазин ЯМ и закрытая фича — 200 без прохода (иначе ЯМ держит очередь)', async () => {
    const foreign = service();
    await foreign.s.receive(
      'ym',
      SECRET,
      { notificationType: 'ORDER_CREATED', campaignId: 9 },
      YM_IP,
      now,
    );
    expect(foreign.scheduler.sendAfterEvent).not.toHaveBeenCalled();

    const closed = service({ features: false });
    const reply = await closed.s.receive(
      'ozon',
      SECRET,
      { message_type: 'TYPE_NEW_POSTING' },
      OZON_IP,
      now,
    );
    expect(reply.status).toBe(200);
    expect(closed.settings.markEvent).toHaveBeenCalledWith('1', 'ozon', now);
    expect(closed.scheduler.sendAfterEvent).not.toHaveBeenCalled();
  });

  it('чужой IP — 403 и алерт с адресом, до поиска секрета; выключенная проверка — пропускает', async () => {
    const { s, settings, errors } = service();
    const reply = await s.receive('ym', SECRET, { notificationType: 'PING' }, '8.8.8.8', now);
    expect(reply.status).toBe(403);
    expect(settings.findBySecret).not.toHaveBeenCalled();
    expect(errors.report).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'stock-push:event:ip:ym' }),
    );
    expect(String(errors.report.mock.calls[0][0].error.message)).toContain('8.8.8.8');

    const open = service({ ipCheck: false });
    expect(
      (await open.s.receive('ym', SECRET, { notificationType: 'PING' }, '8.8.8.8', now)).status,
    ).toBe(200);
  });

  it('сбой очереди — алерт, но 200: событие догонит расписание', async () => {
    const { s, scheduler, errors } = service();
    scheduler.sendAfterEvent.mockRejectedValueOnce(new Error('redis down'));
    const reply = await s.receive(
      'ozon',
      SECRET,
      { message_type: 'TYPE_NEW_POSTING' },
      OZON_IP,
      now,
    );
    expect(reply.status).toBe(200);
    expect(errors.report).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'stock-push:event:ozon', telegramUserId: '1' }),
    );
  });
});

describe('проверка IP отправителя', () => {
  it('подсети площадок из документации, границы, ::ffff:, IPv6 — нет', () => {
    expect(isEventSourceAllowed('ym', '5.45.207.0')).toBe(true);
    expect(isEventSourceAllowed('ym', '5.45.207.127')).toBe(true);
    expect(isEventSourceAllowed('ym', '5.45.207.128')).toBe(false);
    expect(isEventSourceAllowed('ym', '::ffff:141.8.142.1')).toBe(true);
    expect(isEventSourceAllowed('ozon', '185.73.195.255')).toBe(true);
    expect(isEventSourceAllowed('ozon', '185.73.196.0')).toBe(false);
    expect(isEventSourceAllowed('ozon', '91.223.93.5')).toBe(true);
    // Сети не перепутаны: IP Ozon для ЯМ — чужой.
    expect(isEventSourceAllowed('ym', '195.34.21.7')).toBe(false);
    expect(isEventSourceAllowed('ozon', '2a02:6b8::1')).toBe(false);
    expect(isEventSourceAllowed('ym', undefined)).toBe(false);
  });
});

describe('StockPushScheduler — проход по событию', () => {
  const OPEN = {
    [FEATURE.STOCK_PUSH]: true,
    [FEATURE.STOCK_PUSH_SCHEDULE]: true,
    [FEATURE.STOCK_PUSH_WRITE_YM]: true,
  };

  function scheduler(features: Record<string, boolean>) {
    const queue = { add: vi.fn(async () => undefined) };
    const access = {
      findByLogin: vi.fn(async () => [{ telegramUserId: '1', status: 'approved', features }]),
    };
    const s = new StockPushScheduler(
      queue as never,
      access as never,
      { report: vi.fn() } as never,
      {} as never,
      {} as never,
    );
    return { s, queue };
  }

  it('нужны права расписания и stock_push_events сверху', async () => {
    expect(await scheduler(OPEN).s.featuresAfterEvent('1')).toBeNull();
    const open = { ...OPEN, [FEATURE.STOCK_PUSH_EVENTS]: true };
    expect(await scheduler(open).s.featuresAfterEvent('1')).toEqual(open);
    // requires: stock_push_schedule — без расписания событие не пишет.
    const noSchedule = { ...open, [FEATURE.STOCK_PUSH_SCHEDULE]: false };
    expect(await scheduler(noSchedule).s.featuresAfterEvent('1')).toBeNull();
  });

  it('задача — в конце окна, id окна, без токена, одна попытка', async () => {
    const { s, queue } = scheduler(OPEN);
    const at = 10 * STOCK_PUSH_EVENT_WINDOW_MS + 30_000;
    await s.sendAfterEvent('1', at);
    expect(queue.add).toHaveBeenCalledWith(
      JOB_TYPES.SYNC_STOCKS,
      { source: 'schedule', telegramUserId: '1', trigger: 'event' },
      expect.objectContaining({
        jobId: 'stockpushevent-1-10',
        delay: STOCK_PUSH_EVENT_WINDOW_MS - 30_000,
        attempts: 1,
      }),
    );
  });
});
