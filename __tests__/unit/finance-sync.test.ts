import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  IActiveNotification,
  INotificationEvent,
} from '../../src/modules/notifications/notifications.domain';
import type { ITestFinanceDb } from '../helpers/test-postgres';

import { AccountingService } from '../../src/modules/accounting/accounting.service';
import { FinanceSyncRunRepository } from '../../src/database/postgres/repositories/finance-sync-run.repository';
import { monthPeriod } from '../../src/modules/finance/finance-period';
import {
  isSyncFailureFinal,
  mergePeriods,
  missedToQueue,
  reloadWindow,
  syncErrorText,
  syncRetryDelayMs,
  syncWindowRows,
} from '../../src/modules/finance/finance-sync';
import {
  NOTIFICATION_RULE,
  defaultRuleSettings,
  financeSyncEvents,
  isRuleAvailable,
} from '../../src/modules/notifications/notifications.domain';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { FinanceImportProcessor } from '../../src/modules/telegram/queue/processors/finance-import.processor';
import { FinanceSyncService } from '../../src/modules/telegram/queue/services/finance-sync.service';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * Надёжность загрузки «Финучёта» (TASK-212): журнал синхронизации, окно
 * перезагрузки, повторы с backoff, пропуски и уведомление о сбое. Журнал —
 * настоящий Postgres (PGlite, миграции прода), площадка и Redis — заглушки.
 */

describe('правила синхронизации (чистые)', () => {
  it('окно перезагрузки — текущий и N−1 прошлых месяцев, через границу года', () => {
    expect(reloadWindow('2026-02-10', 3).map((p) => p.from)).toEqual([
      '2026-02-01',
      '2026-01-01',
      '2025-12-01',
    ]);
    expect(reloadWindow('2026-02-10', 0)).toHaveLength(1);
  });

  it('объединение периодов без повторов, от нового к старому', () => {
    const merged = mergePeriods(
      [monthPeriod(2026, 11), monthPeriod(2026, 10)],
      reloadWindow('2026-11-08', 3),
    );
    expect(merged.map((p) => p.from)).toEqual(['2026-11-01', '2026-10-01', '2026-09-01']);
  });

  it('backoff: 10, 20, 40 минут', () => {
    expect([1, 2, 3].map(syncRetryDelayMs)).toEqual([600_000, 1_200_000, 2_400_000]);
  });

  it('текст ошибки обрезан', () => {
    expect(syncErrorText(new Error('x'.repeat(900)))).toHaveLength(500);
  });

  const state = (over = {}) => ({
    marketplace: 'ozon' as const,
    periodKey: 'ozon-transaction-list:2026-10-01:2026-10-31',
    from: '2026-10-01',
    to: '2026-10-31',
    lastAttemptAt: new Date('2026-11-08T09:00:00Z'),
    lastOutcome: 'failed' as const,
    lastTrigger: 'retry' as const,
    lastAttempt: 4,
    lastError: 'HTTP 500',
    lastSuccessAt: null,
    ...over,
  });

  it('сбой окончательный — только после последнего повтора', () => {
    expect(isSyncFailureFinal(state({ lastAttempt: 3 }), 3)).toBe(false);
    expect(isSyncFailureFinal(state({ lastAttempt: 4 }), 3)).toBe(true);
    expect(isSyncFailureFinal(state({ lastAttempt: 1, lastTrigger: 'nightly' }), 0)).toBe(true);
    expect(isSyncFailureFinal(state({ lastOutcome: 'imported' }), 3)).toBe(false);
  });

  it('пропуск — в окне без успеха; ставится, когда попытка старше интервала; отключённая площадка — не пропуск', () => {
    const now = new Date('2026-11-08T12:00:00Z');
    const window = reloadWindow('2026-11-08', 3);
    const rows = syncWindowRows(['ozon'], window, [
      state({ lastSuccessAt: null, lastAttemptAt: new Date('2026-11-08T11:00:00Z') }),
      state({
        periodKey: 'ozon-transaction-list:2026-11-01:2026-11-30',
        from: '2026-11-01',
        to: '2026-11-30',
        lastOutcome: 'imported',
        lastSuccessAt: new Date('2026-11-08T09:00:00Z'),
      }),
    ]);
    expect(rows.map((row) => [row.period.from, row.missed])).toEqual([
      ['2026-11-01', false],
      ['2026-10-01', true],
      ['2026-09-01', true],
    ]);
    // Октябрь пробовали час назад — при интервале 3 ч рано; сентябрь не пробовали вовсе.
    expect(missedToQueue(rows, now, 3 * 3_600_000).map((row) => row.period.from)).toEqual([
      '2026-09-01',
    ]);
    expect(missedToQueue(rows, now, 30 * 60_000).map((row) => row.period.from)).toEqual([
      '2026-10-01',
      '2026-09-01',
    ]);
    const off = syncWindowRows(['ozon'], window.slice(1, 2), [
      state({ lastOutcome: 'not-connected' }),
    ]);
    expect(missedToQueue(off, now, 0)).toEqual([]);
  });

  it('уведомление о сбое: месяц площадки, отпечаток без числа попыток; правило — только с fin_accounting', () => {
    const settings = defaultRuleSettings();
    const [event] = financeSyncEvents([state()], 3, settings);
    expect(event).toMatchObject({
      rule: NOTIFICATION_RULE.FINANCE_SYNC_FAILED,
      subjectKey: 'ozon:2026-10',
      fingerprint: 'failed',
      marketplace: 'ozon',
    });
    expect(event.title).toContain('10.2026');
    expect(financeSyncEvents([state({ lastAttempt: 2 })], 3, settings)).toEqual([]);
    settings.finance_sync_failed.enabled = false;
    expect(financeSyncEvents([state()], 3, settings)).toEqual([]);

    expect(isRuleAvailable(NOTIFICATION_RULE.FINANCE_SYNC_FAILED, {})).toBe(false);
    expect(
      isRuleAvailable(NOTIFICATION_RULE.FINANCE_SYNC_FAILED, { [FEATURE.FIN_ACCOUNTING]: true }),
    ).toBe(true);
    expect(isRuleAvailable(NOTIFICATION_RULE.SALES_DROP, {})).toBe(true);
  });
});

describe('журнал синхронизации и процессор (PGlite)', () => {
  let test: ITestFinanceDb;
  let runs: FinanceSyncRunRepository;

  beforeAll(async () => {
    test = await createTestFinanceDb();
    runs = new FinanceSyncRunRepository(test.db);
  }, 60_000);

  afterAll(async () => {
    await test?.close();
  });

  beforeEach(async () => {
    await test.reset();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-08T09:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Уведомления в памяти: активные по (правило, предмет). */
  function memoryFeed() {
    const active: (IActiveNotification & { title: string })[] = [];
    return {
      active,
      listActive: vi.fn(async () =>
        active.map(({ rule, subjectKey, fingerprint }) => ({ rule, subjectKey, fingerprint })),
      ),
      apply: vi.fn(
        async (_: string, toResolve: IActiveNotification[], toCreate: INotificationEvent[]) => {
          for (const row of toResolve) {
            const i = active.findIndex(
              (a) => a.rule === row.rule && a.subjectKey === row.subjectKey,
            );
            if (i >= 0) active.splice(i, 1);
          }
          active.push(...toCreate);
          return toCreate as never[];
        },
      ),
    };
  }

  function harness(options: { importFinance: () => Promise<unknown>; maxRetries?: number }) {
    const config = {
      finAccountingRetryAttempts: options.maxRetries ?? 2,
      finAccountingReloadMonths: 3,
      finAccountingSyncEveryHours: 3,
    };
    const scheduler = {
      marketplacesFor: vi.fn(async () => ['ym', 'ozon']),
      accountingMarketplacesFor: vi.fn(async () => ['ozon']),
      scheduleRetry: vi.fn(async () => undefined),
      refresh: vi.fn(async () => undefined),
    };
    const errors = { report: vi.fn(async () => undefined) };
    const feed = memoryFeed();
    const notifications = new NotificationsService(
      { get: vi.fn(async () => ({ rules: defaultRuleSettings() })) } as never,
      feed as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      errors as never,
      runs,
      config as never,
    );
    const access = {
      findByLogin: vi.fn(async () => [
        {
          telegramUserId: '222',
          status: 'approved',
          features: {
            [FEATURE.FINANCE]: true,
            [FEATURE.NOTIFICATIONS]: true,
            [FEATURE.FIN_ACCOUNTING]: true,
            [FEATURE.OZON]: true,
          },
        },
      ]),
    };
    const sync = new FinanceSyncService(
      scheduler as never,
      runs,
      config as never,
      access as never,
      notifications,
      errors as never,
    );
    const importFinance = vi.fn(options.importFinance);
    const registry = {
      withCapability: () => ['ym', 'ozon', 'wb'],
      require: () => ({ importFinance }),
    };
    const processor = new FinanceImportProcessor(
      registry as never,
      scheduler as never,
      errors as never,
      sync,
    );
    return { processor, scheduler, feed, importFinance, errors };
  }

  const OCT = {
    telegramUserId: '222',
    marketplace: 'ozon' as const,
    from: '2026-10-01',
    to: '2026-10-31',
  };

  it('сбой API: повтор с backoff, после последнего — уведомление; последний успех не затёрт', async () => {
    // Успешная загрузка октября — раньше.
    await runs.record({
      telegramUserId: '222',
      marketplace: 'ozon',
      periodKey: 'ozon-transaction-list:2026-10-01:2026-10-31',
      periodFrom: '2026-10-01',
      periodTo: '2026-10-31',
      trigger: 'nightly',
      attempt: 1,
      outcome: 'imported',
      startedAt: new Date('2026-11-07T01:00:00Z'),
      finishedAt: new Date('2026-11-07T01:01:00Z'),
    });
    const { processor, scheduler, feed } = harness({
      importFinance: async () => {
        throw new Error('Ozon HTTP 500');
      },
      maxRetries: 2,
    });

    // Первая попытка (по кнопке «повтор» здесь не важен — как из расписания) — сбой → повтор №2 через 10 мин.
    await processor.handle({ data: { ...OCT, trigger: 'retry', attempt: 1 } } as never);
    expect(scheduler.scheduleRetry).toHaveBeenLastCalledWith(
      '222',
      'ozon',
      { from: '2026-10-01', to: '2026-10-31' },
      2,
      600_000,
    );
    // Повтор №2 — сбой → №3 через 20 мин.
    vi.setSystemTime(new Date('2026-11-08T09:10:00Z'));
    await processor.handle({ data: { ...OCT, trigger: 'retry', attempt: 2 } } as never);
    expect(scheduler.scheduleRetry).toHaveBeenLastCalledWith(
      '222',
      'ozon',
      expect.anything(),
      3,
      1_200_000,
    );
    expect(feed.active).toEqual([]);
    // №3 — последний: повтора нет, уведомление.
    vi.setSystemTime(new Date('2026-11-08T09:30:00Z'));
    await processor.handle({ data: { ...OCT, trigger: 'retry', attempt: 3 } } as never);
    expect(scheduler.scheduleRetry).toHaveBeenCalledTimes(2);
    expect(feed.active).toHaveLength(1);
    expect(feed.active[0]).toMatchObject({
      rule: 'finance_sync_failed',
      subjectKey: 'ozon:2026-10',
    });
    expect(feed.active[0].body).toContain('Попыток: 3');

    const [state] = await runs.states('222', ['ozon']);
    expect(state).toMatchObject({
      lastOutcome: 'failed',
      lastAttempt: 3,
      lastError: 'Ozon HTTP 500',
    });
    expect(state.lastSuccessAt).toEqual(new Date('2026-11-07T01:01:00Z'));
  });

  it('успешный повтор снимает уведомление; другие правила не трогаются', async () => {
    const failing = harness({
      importFinance: async () => {
        throw new Error('boom');
      },
      maxRetries: 0,
    });
    failing.feed.active.push({
      rule: 'sales_drop',
      subjectKey: 'ym',
      fingerprint: 'drop',
      title: 'старое',
    });
    await failing.processor.handle({ data: { ...OCT, trigger: 'retry', attempt: 1 } } as never);
    expect(failing.feed.active.map((a) => a.rule).sort()).toEqual([
      'finance_sync_failed',
      'sales_drop',
    ]);

    const ok = harness({ importFinance: async () => ({ status: 'imported' }) });
    ok.feed.active.push(...failing.feed.active);
    await ok.processor.handle({ data: { ...OCT, trigger: 'retry', attempt: 2 } } as never);
    expect(ok.feed.active.map((a) => a.rule)).toEqual(['sales_drop']);
  });

  it('кнопка: сбой уходит в Bull, как до TASK-212, и пишется в журнал', async () => {
    const { processor } = harness({
      importFinance: async () => {
        throw new Error('Маркет FAILED');
      },
    });
    await expect(processor.handle({ data: { ...OCT } } as never)).rejects.toThrow('Маркет FAILED');
    const [state] = await runs.states('222');
    expect(state).toMatchObject({
      lastTrigger: 'manual',
      lastOutcome: 'failed',
      lastSuccessAt: null,
    });
  });

  it('частая задача: текущий месяц ЯМ и Ozon «Финучёта» + пропущенные месяцы окна', async () => {
    const { processor, importFinance } = harness({
      importFinance: async () => ({ status: 'imported' }),
    });
    const run = await processor.handle({
      data: { telegramUserId: '222', scheduled: true, mode: 'frequent' },
    } as never);
    // «Финучёт» у продавца — только Ozon: ЯМ частой задачей не грузится.
    expect(run).toMatchObject({
      periods: [
        { marketplace: 'ozon', from: '2026-11-01', status: 'imported' },
        { marketplace: 'ozon', from: '2026-10-01', trigger: 'missed' },
        { marketplace: 'ozon', from: '2026-09-01', trigger: 'missed' },
      ],
    });
    expect(importFinance).toHaveBeenCalledTimes(3);

    // Второй проход: пропусков больше нет — только текущий месяц.
    importFinance.mockClear();
    await processor.handle({
      data: { telegramUserId: '222', scheduled: true, mode: 'frequent' },
    } as never);
    expect(importFinance).toHaveBeenCalledTimes(1);
  });

  it('ночью площадке «Финучёта» — окно перезагрузки, остальным — прежние месяцы', async () => {
    const { processor, importFinance } = harness({
      importFinance: async () => ({ status: 'unchanged' }),
    });
    const run = (await processor.handle({
      data: { telegramUserId: '222', scheduled: true },
    } as never)) as { periods: { marketplace: string; from: string }[] };
    expect(run.periods.map((p) => `${p.marketplace} ${p.from}`)).toEqual([
      'ym 2026-11-01',
      'ym 2026-10-01',
      'ozon 2026-11-01',
      'ozon 2026-10-01',
      'ozon 2026-09-01',
    ]);
    expect(importFinance).toHaveBeenCalledTimes(5);
    expect((await runs.states('222')).every((s) => s.lastTrigger === 'nightly')).toBe(true);
  });

  it('CRM: по площадке — «данные на» последний успех, месяцы окна с пропусками и ошибкой', async () => {
    await runs.record({
      telegramUserId: '222',
      marketplace: 'ym',
      periodKey: 'united-netting:2026-11-01:2026-11-30',
      periodFrom: '2026-11-01',
      periodTo: '2026-11-30',
      trigger: 'frequent',
      attempt: 1,
      outcome: 'imported',
      startedAt: new Date('2026-11-08T06:00:00Z'),
      finishedAt: new Date('2026-11-08T06:01:00Z'),
    });
    await runs.record({
      telegramUserId: '222',
      marketplace: 'ym',
      periodKey: 'united-netting:2026-10-01:2026-10-31',
      periodFrom: '2026-10-01',
      periodTo: '2026-10-31',
      trigger: 'nightly',
      attempt: 1,
      outcome: 'failed',
      error: 'FAILED',
      startedAt: new Date('2026-11-08T01:00:00Z'),
      finishedAt: new Date('2026-11-08T01:01:00Z'),
    });
    const service = new AccountingService(
      runs,
      {
        findByTelegramUser: vi.fn(async () => ({ campaign_id: '1', business_id: '2', token: 't' })),
      } as never,
      { connectedUsers: vi.fn(async () => new Set<string>()) } as never,
      { finAccountingReloadMonths: 3, finAccountingSyncEveryHours: 3 } as never,
    );
    const view = await service.syncStatus('222', {});
    expect(view.asOf).toBe('2026-11-08T06:01:00.000Z');
    expect(view.marketplaces).toHaveLength(1);
    const [ym] = view.marketplaces;
    expect(ym).toMatchObject({ marketplace: 'ym', lastSuccessAt: '2026-11-08T06:01:00.000Z' });
    expect(ym.periods.map((p) => [p.month, p.outcome, p.missed, p.error])).toEqual([
      ['2026-11', 'imported', false, null],
      ['2026-10', 'failed', true, 'FAILED'],
      ['2026-09', null, true, null],
    ]);
  });
});
