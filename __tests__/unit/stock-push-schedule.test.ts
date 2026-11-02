import { describe, it, expect, vi } from 'vitest';

import {
  parseInterval,
  toCrmPushSchedule,
} from '../../src/modules/crm/stock-push/crm-stock-push.domain';
import { blockAlerts } from '../../src/modules/stock-push/stock-push-alerts';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { JOB_TYPES } from '../../src/modules/telegram/index';
import {
  PUSH_CRON_BY_INTERVAL,
  isPushInterval,
  pushCronOf,
} from '../../src/modules/stock-push/stock-push-interval';
import {
  parsePushJobId,
  pickPushUsers,
  pushAfterPriceListJobId,
  pushJobId,
  pushNowJobId,
} from '../../src/modules/telegram/queue/services/stock-push-schedule';
import { StockPushScheduler } from '../../src/modules/telegram/queue/services/stock-push.scheduler';
import { MOSCOW_TIME_ZONE } from '../../src/modules/yandex/reports/moscow-day';
import { bullRepeatKey, fakeRepeatableQueue } from '../helpers/fake-repeatable-queue';

/**
 * «Передача остатков» по расписанию (TASK-176): кому заводится проход, id
 * повторяемой задачи без двоеточий, сверка без дублей и алерт «до смены
 * состояния». Сам проход — в stock-push.test.ts.
 */

const PUSH_CRON = PUSH_CRON_BY_INTERVAL['30m'];

/** Настройки частоты: без документа — умолчание (30 минут). */
function settingsOf(intervals: Record<string, string> = {}) {
  return {
    intervalsFor: vi.fn(async (ids: string[]) => {
      const map = new Map<string, string>();
      for (const id of ids) if (intervals[id]) map.set(id, intervals[id]);
      return map;
    }),
    intervalOf: vi.fn(async (id: string) => intervals[id] ?? '30m'),
    setInterval: vi.fn(async (id: string, interval: string) => {
      intervals[id] = interval;
      return interval;
    }),
  };
}

const OPEN = {
  [FEATURE.STOCK_PUSH]: true,
  [FEATURE.STOCK_PUSH_SCHEDULE]: true,
  [FEATURE.STOCK_PUSH_WRITE_YM]: true,
};

describe('правила расписания', () => {
  it('каждые 30 минут; id без двоеточий и разбирается обратно, разовый — нет', () => {
    expect(pushCronOf(undefined)).toBe('*/30 * * * *');
    expect(pushJobId('42')).toBe('stockpush-42');
    expect(pushJobId('42')).not.toContain(':');
    expect(pushNowJobId('42')).not.toContain(':');
    expect(parsePushJobId('stockpush-42')).toBe('42');
    expect(parsePushJobId('stockpushnow-42')).toBeNull();
    expect(pushAfterPriceListJobId('42')).toBe('stockpushfile-42');
    expect(parsePushJobId('stockpushfile-42')).toBeNull();
    expect(parsePushJobId('weeklydigest-42')).toBeNull();
    expect(parsePushJobId(null)).toBeNull();
  });

  it('проход — одобренным с фичей расписания и хоть одной записью площадки', () => {
    const picked = pickPushUsers([
      { telegramUserId: '1', status: 'approved', features: OPEN },
      // Нет записи ни одной площадки — проходу нечего писать.
      {
        telegramUserId: '2',
        status: 'approved',
        features: { [FEATURE.STOCK_PUSH]: true, [FEATURE.STOCK_PUSH_SCHEDULE]: true },
      },
      // Расписание закрыто — пишет только кнопка.
      {
        telegramUserId: '3',
        status: 'approved',
        features: { [FEATURE.STOCK_PUSH]: true, [FEATURE.STOCK_PUSH_WRITE_YM]: true },
      },
      // `requires: stock_push` — без плана расписание закрыто.
      {
        telegramUserId: '4',
        status: 'approved',
        features: { ...OPEN, [FEATURE.STOCK_PUSH]: false },
      },
      { telegramUserId: '5', status: 'blocked', features: OPEN },
      // Вторая строка того же продавца (другой бот) не перебивает первую.
      { telegramUserId: '1', status: 'approved', features: {} },
    ]);
    expect([...picked.keys()]).toEqual(['1']);
    expect(picked.get('1')).toEqual(OPEN);
  });

  it('после прайса из бота расписание не нужно — хватает stock_push и записи площадки', () => {
    const noSchedule = {
      [FEATURE.STOCK_PUSH]: true,
      [FEATURE.OZON]: true,
      [FEATURE.STOCK_PUSH_WRITE_OZON]: true,
    };
    const picked = pickPushUsers(
      [
        { telegramUserId: '1', status: 'approved', features: noSchedule },
        // Без записи хоть одной площадки — проходу нечего писать.
        { telegramUserId: '2', status: 'approved', features: { [FEATURE.STOCK_PUSH]: true } },
        // Без плана запись не открыта (`requires: stock_push`).
        {
          telegramUserId: '3',
          status: 'approved',
          features: { [FEATURE.STOCK_PUSH_WRITE_YM]: true },
        },
        { telegramUserId: '4', status: 'blocked', features: noSchedule },
      ],
      { requireSchedule: false },
    );
    expect([...picked.keys()]).toEqual(['1']);
  });

  it('по умолчанию фича закрыта — без решения владельца никому не заводится', () => {
    expect(pickPushUsers([{ telegramUserId: '1', status: 'approved' }]).size).toBe(0);
  });
});

describe('blockAlerts — алерт при смене состояния', () => {
  it('первый блок алертит, держится — нет, смена причины — да, снятие забывает', () => {
    const memory = new Map();
    const blocked = { key: 'c1', blockedBy: 'read-error' as const };

    expect(blockAlerts(memory, [blocked])).toEqual([blocked]);
    expect(blockAlerts(memory, [blocked])).toEqual([]);

    const zeroing = { key: 'c1', blockedBy: 'zeroing' as const };
    expect(blockAlerts(memory, [zeroing])).toEqual([zeroing]);

    expect(blockAlerts(memory, [{ key: 'c1', blockedBy: null }])).toEqual([]);
    expect(memory.size).toBe(0);
    expect(blockAlerts(memory, [zeroing])).toEqual([zeroing]);
  });

  it('FBY и «только просмотр» — устройство магазина, не сбой: без алерта', () => {
    const memory = new Map();
    expect(
      blockAlerts(memory, [
        { key: 'c1', blockedBy: 'placement' },
        { key: 'ozon', blockedBy: 'no-write-method' },
      ]),
    ).toEqual([]);
  });

  it('цель пропала из плана — её блок забыт', () => {
    const memory = new Map();
    blockAlerts(memory, [{ key: 'ozon:7', blockedBy: 'several-warehouses' }]);
    blockAlerts(memory, []);
    expect(memory.size).toBe(0);
  });
});

describe('частота от продавца (stock_push_interval_by_seller)', () => {
  it('cron на каждую частоту, «выключена» — без задачи, мусор — умолчание', () => {
    expect(pushCronOf('1h')).toBe('0 * * * *');
    expect(pushCronOf('3h')).toBe('0 */3 * * *');
    expect(pushCronOf('6h')).toBe('0 */6 * * *');
    expect(pushCronOf('off')).toBeNull();
    expect(pushCronOf('15m')).toBe('*/30 * * * *');
    expect(isPushInterval('15m')).toBe(false);
    expect(isPushInterval('off')).toBe(true);
  });
});

describe('CRM: синхронизация остатков — доставка', () => {
  it('частота проверяется по закрытому списку', () => {
    expect(parseInterval('3h')).toBe('3h');
    expect(parseInterval('15m')).toBeNull();
    expect(parseInterval(undefined)).toBeNull();
  });

  it('вид: варианты по порядку, итог без вида прохода, «выключена» — без следующего', () => {
    const view = toCrmPushSchedule({
      interval: 'off',
      nextRunAt: '2026-11-02T12:00:00.000Z',
      lastRun: {
        at: '2026-11-02T11:30:00.000Z',
        status: 'error',
        action: 'передача остатков по расписанию: записано 3 из 4; Ozon «Дом»: отвергнуто батчей 1',
      },
    });
    expect(view.options.map((o) => o.value)).toEqual(['30m', '1h', '3h', '6h', 'off']);
    expect(view.intervalLabel).toBe('выключена');
    expect(view.nextRunAt).toBeNull();
    expect(view.lastRun).toEqual({
      at: '2026-11-02T11:30:00.000Z',
      ok: false,
      summary: 'записано 3 из 4; Ozon «Дом»: отвергнуто батчей 1',
    });
    expect(view.about.length).toBeGreaterThan(0);
  });
});

describe('StockPushScheduler — сверка расписания', () => {
  function scheduler(initial: string[] = [], intervals: Record<string, string> = {}) {
    const queue = fakeRepeatableQueue(initial, JOB_TYPES.SYNC_STOCKS);
    const accounts = [
      { telegramUserId: '1', status: 'approved', features: OPEN },
      { telegramUserId: '2', status: 'approved', features: {} },
    ];
    const access = {
      list: vi.fn(async () => accounts),
      findByLogin: vi.fn(async (id: string) => accounts.filter((a) => a.telegramUserId === id)),
    };
    const settings = settingsOf(intervals);
    const actionLog = {
      list: vi.fn(async () => [
        {
          createdAt: new Date('2026-11-02T11:30:00Z'),
          status: 'ok',
          action: 'передача остатков по расписанию: записано 3 из 3',
        },
      ]),
    };
    const s = new StockPushScheduler(
      queue as never,
      access as never,
      { report: vi.fn() } as never,
      settings as never,
      actionLog as never,
    );
    return { s, queue, settings, actionLog };
  }

  it('повторная сверка (рестарт) не плодит дубль; лишняя снимается, чужие в очереди — нет', async () => {
    const stale = bullRepeatKey(JOB_TYPES.SYNC_STOCKS, pushJobId('2'), PUSH_CRON, MOSCOW_TIME_ZONE);
    const oldCron = bullRepeatKey(
      JOB_TYPES.SYNC_STOCKS,
      pushJobId('1'),
      '0 * * * *',
      MOSCOW_TIME_ZONE,
    );
    const foreign = bullRepeatKey('other', 'weeklydigest-2', '0 10 * * 1', MOSCOW_TIME_ZONE);
    const { s, queue } = scheduler([stale, oldCron, foreign]);

    expect(await s.reconcile()).toEqual({ added: 1, removed: 2 });
    expect(await s.reconcile()).toEqual({ added: 0, removed: 0 });

    expect(await s.jobs()).toEqual([
      expect.objectContaining({ telegramUserId: '1', cron: PUSH_CRON, tz: MOSCOW_TIME_ZONE }),
    ]);
    expect(queue.keys).toContain(foreign);
    const [name, payload, options] = queue.add.mock.calls[0];
    expect(name).toBe(JOB_TYPES.SYNC_STOCKS);
    // Ни токена, ни снимка фич: они перечитываются в момент прохода.
    expect(payload).toEqual({ source: 'schedule', telegramUserId: '1' });
    expect(options).toMatchObject({
      jobId: 'stockpush-1',
      repeat: { cron: PUSH_CRON, tz: MOSCOW_TIME_ZONE },
      attempts: 1,
    });
  });

  it('сменили частоту — задача пересоздаётся с новым cron; «выключена» — снимается', async () => {
    const { s } = scheduler();
    await s.reconcile();

    await s.setInterval('1', '3h');
    expect(await s.jobs()).toEqual([
      expect.objectContaining({ telegramUserId: '1', cron: '0 */3 * * *' }),
    ]);

    const status = await s.setInterval('1', 'off');
    expect(await s.jobs()).toEqual([]);
    expect(status).toEqual({
      interval: 'off',
      nextRunAt: null,
      lastRun: {
        at: '2026-11-02T11:30:00.000Z',
        status: 'ok',
        action: 'передача остатков по расписанию: записано 3 из 3',
      },
    });
  });

  it('statusFor — следующий запуск из задачи, итог — строка журнала продавца', async () => {
    const { s, actionLog } = scheduler();
    await s.reconcile();
    const status = await s.statusFor('1');
    expect(status.interval).toBe('30m');
    expect(status.nextRunAt).not.toBeNull();
    expect(actionLog.list).toHaveBeenCalledWith({
      telegramUserId: '1',
      kind: 'stock-push-schedule',
      limit: 1,
    });
  });

  it('featuresFor — фичи продавца с открытым расписанием, иначе null', async () => {
    const { s } = scheduler();
    expect(await s.featuresFor('1')).toEqual(OPEN);
    expect(await s.featuresFor('2')).toBeNull();
  });

  it('featuresAfterPriceList — без требования расписания', async () => {
    const queue = fakeRepeatableQueue([], JOB_TYPES.SYNC_STOCKS);
    const features = {
      [FEATURE.STOCK_PUSH]: true,
      [FEATURE.WB]: true,
      [FEATURE.STOCK_PUSH_WRITE_WB]: true,
    };
    const access = {
      findByLogin: vi.fn(async () => [{ telegramUserId: '7', status: 'approved', features }]),
    };
    const s = new StockPushScheduler(queue as never, access as never, { report: vi.fn() } as never);
    expect(await s.featuresAfterPriceList('7')).toEqual(features);
    expect(await s.featuresFor('7')).toBeNull();
  });

  it('проход после прайса из бота — свой id, чат для итога, без токена, одна попытка', async () => {
    const queue = { add: vi.fn(async () => undefined) };
    const s = new StockPushScheduler(queue as never, {} as never, { report: vi.fn() } as never);
    await s.sendAfterPriceList('1', 999, '555');
    expect(queue.add).toHaveBeenCalledWith(
      JOB_TYPES.SYNC_STOCKS,
      { source: 'schedule', telegramUserId: '1', trigger: 'price-list', botId: 999, chatId: '555' },
      expect.objectContaining({ jobId: 'stockpushfile-1', attempts: 1 }),
    );
  });

  it('разовый проход — свой id, одна попытка', async () => {
    const queue = { add: vi.fn(async () => undefined) };
    const s = new StockPushScheduler(queue as never, {} as never, { report: vi.fn() } as never);
    await s.sendNow('1');
    expect(queue.add).toHaveBeenCalledWith(
      JOB_TYPES.SYNC_STOCKS,
      { source: 'schedule', telegramUserId: '1', manual: true },
      expect.objectContaining({ jobId: 'stockpushnow-1', attempts: 1 }),
    );
  });
});
