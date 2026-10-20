import { describe, it, expect, vi } from 'vitest';

import { blockAlerts } from '../../src/modules/stock-push/stock-push-alerts';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { JOB_TYPES } from '../../src/modules/telegram/index';
import {
  PUSH_CRON,
  parsePushJobId,
  pickPushUsers,
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

const OPEN = {
  [FEATURE.STOCK_PUSH]: true,
  [FEATURE.STOCK_PUSH_SCHEDULE]: true,
  [FEATURE.STOCK_PUSH_WRITE_YM]: true,
};

describe('правила расписания', () => {
  it('каждые 30 минут; id без двоеточий и разбирается обратно, разовый — нет', () => {
    expect(PUSH_CRON).toBe('*/30 * * * *');
    expect(pushJobId('42')).toBe('stockpush-42');
    expect(pushJobId('42')).not.toContain(':');
    expect(pushNowJobId('42')).not.toContain(':');
    expect(parsePushJobId('stockpush-42')).toBe('42');
    expect(parsePushJobId('stockpushnow-42')).toBeNull();
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

describe('StockPushScheduler — сверка расписания', () => {
  function scheduler(initial: string[] = []) {
    const queue = fakeRepeatableQueue(initial, JOB_TYPES.SYNC_STOCKS);
    const accounts = [
      { telegramUserId: '1', status: 'approved', features: OPEN },
      { telegramUserId: '2', status: 'approved', features: {} },
    ];
    const access = {
      list: vi.fn(async () => accounts),
      findByLogin: vi.fn(async (id: string) => accounts.filter((a) => a.telegramUserId === id)),
    };
    const s = new StockPushScheduler(queue as never, access as never, { report: vi.fn() } as never);
    return { s, queue };
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

  it('featuresFor — фичи продавца с открытым расписанием, иначе null', async () => {
    const { s } = scheduler();
    expect(await s.featuresFor('1')).toEqual(OPEN);
    expect(await s.featuresFor('2')).toBeNull();
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
