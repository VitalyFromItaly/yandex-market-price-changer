import { describe, expect, it, vi } from 'vitest';

import {
  dayStatus,
  isPeriodClosed,
  periodStatusOf,
} from '../../src/modules/finance/finance-period-status';
import {
  financeToday,
  monthPeriod,
  requestRange,
  scheduledPeriods,
} from '../../src/modules/finance/finance-period';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { JOB_TYPES } from '../../src/modules/telegram';
import { FinanceImportScheduler } from '../../src/modules/telegram/queue/services/finance-import.scheduler';
import {
  financeCron,
  financeJobId,
  parseFinanceJobId,
  pickFinanceUsers,
} from '../../src/modules/telegram/queue/services/finance-schedule';
import { MOSCOW_TIME_ZONE } from '../../src/modules/yandex/reports/moscow-day';
import { fakeRepeatableQueue } from '../helpers/fake-repeatable-queue';
import type { TInitialRepeatable } from '../helpers/fake-repeatable-queue';

describe('периоды ночного прохода', () => {
  it('будний день — текущий и прошлый месяц, от текущего', () => {
    // 15-10-2026 — четверг. Текущий первым: сверке прошлого нужен его отчёт (TASK-113).
    expect(scheduledPeriods('2026-10-15')).toEqual([monthPeriod(2026, 10), monthPeriod(2026, 9)]);
  });

  it('понедельник — ещё и позапрошлый', () => {
    expect(scheduledPeriods('2026-10-12')).toEqual([
      monthPeriod(2026, 10),
      monthPeriod(2026, 9),
      monthPeriod(2026, 8),
    ]);
  });

  it('январь уходит в прошлый год', () => {
    // 04-01-2027 — понедельник.
    expect(scheduledPeriods('2027-01-04')).toEqual([
      monthPeriod(2027, 1),
      monthPeriod(2026, 12),
      monthPeriod(2026, 11),
    ]);
  });

  it('незакрытый месяц запрашивается по сегодня, закрытый — целиком', () => {
    expect(requestRange(monthPeriod(2026, 10), '2026-10-15')).toEqual({
      from: '2026-10-01',
      to: '2026-10-15',
    });
    expect(requestRange(monthPeriod(2026, 9), '2026-10-15')).toEqual(monthPeriod(2026, 9));
  });

  it('сегодня — по Москве, а не по UTC', () => {
    // 22:30 UTC 15-10 — уже 16-10 в Москве.
    expect(financeToday(new Date('2026-10-15T22:30:00Z'))).toBe('2026-10-16');
  });
});

describe('статус периода', () => {
  const checked = { state: 'checked' as const, discrepancies: 0 };
  const counters = { documentVersion: 1, unknown: 0, changed: 0, removed: 0, reconcile: checked };

  it('месяц закрыт со следующего дня после последнего', () => {
    expect(isPeriodClosed('2026-09-30', '2026-09-30')).toBe(false);
    expect(isPeriodClosed('2026-09-30', '2026-10-01')).toBe(true);
  });

  it('чистый импорт закрытого месяца — «Проверено», незакрытого — «предварительные»', () => {
    const attempt = { outcome: 'imported' as const, ...counters };
    expect(
      periodStatusOf({ periodTo: '2026-09-30', today: '2026-10-15', attempt, previous: null }),
    ).toMatchObject({ status: 'verified', documentVersion: 1, error: null });
    expect(
      periodStatusOf({ periodTo: '2026-10-31', today: '2026-10-15', attempt, previous: null })
        .status,
    ).toBe('preliminary');
  });

  it.each([
    ['без статьи', { unknown: 2 }],
    ['пересчитано', { changed: 1 }],
    ['убрано', { removed: 1 }],
  ])('%s — «Есть расхождения»', (_, over) => {
    const attempt = { outcome: 'unchanged' as const, ...counters, ...over };
    expect(
      periodStatusOf({ periodTo: '2026-09-30', today: '2026-10-15', attempt, previous: null })
        .status,
    ).toBe('discrepancy');
  });

  it('отчёта нет — «предварительные»', () => {
    expect(
      periodStatusOf({
        periodTo: '2026-09-30',
        today: '2026-10-15',
        attempt: { outcome: 'empty' },
        previous: null,
      }),
    ).toMatchObject({ status: 'preliminary', lastOutcome: 'empty', documentVersion: null });
  });

  it('сбой не гасит «Проверено», но ошибка видна', () => {
    const previous = periodStatusOf({
      periodTo: '2026-09-30',
      today: '2026-10-15',
      attempt: { outcome: 'imported', ...counters },
      previous: null,
    });
    expect(
      periodStatusOf({
        periodTo: '2026-09-30',
        today: '2026-10-16',
        attempt: { outcome: 'failed', error: 'boom' },
        previous,
      }),
    ).toMatchObject({
      status: 'verified',
      lastOutcome: 'failed',
      error: 'boom',
      documentVersion: 1,
    });
  });

  it('сбой без прошлого — «предварительные»', () => {
    expect(
      periodStatusOf({
        periodTo: '2026-09-30',
        today: '2026-10-15',
        attempt: { outcome: 'failed', error: 'boom' },
        previous: null,
      }).status,
    ).toBe('preliminary');
  });

  it('находка сверки — «Есть расхождения», и число её видно', () => {
    const attempt = {
      outcome: 'imported' as const,
      ...counters,
      reconcile: { state: 'checked' as const, discrepancies: 3 },
    };
    expect(
      periodStatusOf({ periodTo: '2026-09-30', today: '2026-10-15', attempt, previous: null }),
    ).toMatchObject({ status: 'discrepancy', discrepancyCount: 3, reconcileState: 'checked' });
  });

  it('сверка не сделана — не «Проверено», причина видна', () => {
    for (const reconcile of [
      { state: 'unchecked' as const, discrepancies: 0, reason: 'нет соседа' },
      { state: 'failed' as const, error: 'Маркет недоступен' },
    ]) {
      const attempt = { outcome: 'unchanged' as const, ...counters, reconcile };
      expect(
        periodStatusOf({ periodTo: '2026-09-30', today: '2026-10-15', attempt, previous: null }),
      ).toMatchObject({
        status: 'preliminary',
        reconcileState: reconcile.state,
        reconcileNote: 'reason' in reconcile ? reconcile.reason : reconcile.error,
      });
    }
  });

  it('неполная сверка, но находка уже есть — «Есть расхождения»', () => {
    const attempt = {
      outcome: 'unchanged' as const,
      ...counters,
      reconcile: { state: 'unchecked' as const, discrepancies: 1, reason: 'нет соседа' },
    };
    expect(
      periodStatusOf({ periodTo: '2026-09-30', today: '2026-10-15', attempt, previous: null })
        .status,
    ).toBe('discrepancy');
  });

  it('незакрытый месяц со «skipped» — «предварительные», счётчик сверки 0', () => {
    const attempt = {
      outcome: 'imported' as const,
      ...counters,
      reconcile: { state: 'skipped' as const },
    };
    expect(
      periodStatusOf({ periodTo: '2026-10-31', today: '2026-10-15', attempt, previous: null }),
    ).toMatchObject({ status: 'preliminary', discrepancyCount: 0, reconcileState: 'skipped' });
  });

  it('статус дня — статус его месяца; день вне загруженных — «предварительные»', () => {
    const periods = [
      { periodFrom: '2026-09-01', periodTo: '2026-09-30', status: 'verified' as const },
    ];
    expect(dayStatus('2026-09-17', periods)).toBe('verified');
    expect(dayStatus('2026-10-01', periods)).toBe('preliminary');
  });
});

describe('правила расписания', () => {
  it('jobId выводится из продавца и разбирается обратно', () => {
    expect(financeJobId('111')).toBe('finance-111');
    expect(parseFinanceJobId('finance-111')).toBe('111');
    expect(parseFinanceJobId('hosting-reminder')).toBeNull();
    // Bull режет ключ повторяемой задачи по «:» — двоеточие в id ломает сверку.
    expect(financeJobId('309809755')).not.toContain(':');
    expect(parseFinanceJobId('finance-')).toBeNull();
  });

  it('cron детерминирован, ночью с 03:00 до 05:59', () => {
    for (const id of ['1', '111', '309809755', '987654321']) {
      expect(financeCron(id)).toBe(financeCron(id));
      const [minute, hour, ...rest] = financeCron(id).split(' ');
      expect(Number(minute)).toBeLessThan(60);
      expect([3, 4, 5]).toContain(Number(hour));
      expect(rest).toEqual(['*', '*', '*']);
    }
  });

  it('берёт одобренных с фичей и админов — только с магазином', () => {
    const accounts = [
      { telegramUserId: '1', status: 'approved', features: { [FEATURE.FINANCE]: true } },
      // Фича по умолчанию закрыта.
      { telegramUserId: '2', status: 'approved', features: {} },
      // Фича открыта, а доступ — нет.
      { telegramUserId: '3', status: 'rejected', features: { [FEATURE.FINANCE]: true } },
      // Фича открыта, магазина нет.
      { telegramUserId: '4', status: 'approved', features: { [FEATURE.FINANCE]: true } },
      // Две записи (два бота) — одна задача.
      { telegramUserId: '1', status: 'pending', features: {} },
    ];
    const configured = new Set(['1', '2', '3', '9', '10']);

    expect(pickFinanceUsers(accounts, [9, 11], configured)).toEqual(['1', '9']);
  });
});

/** Очередь-заглушка, разбирающая ключ по «:», как Bull 4 (TASK-157). */
function fakeQueue(initial: TInitialRepeatable[] = []) {
  return fakeRepeatableQueue(initial, JOB_TYPES.IMPORT_FINANCE);
}

function build(
  queue: ReturnType<typeof fakeQueue>,
  accounts: unknown[],
  storeIds: string[],
  adminIds: number[] = [],
) {
  const access = { list: vi.fn(async () => accounts) };
  const stores = {
    findByTelegramUsers: vi.fn(async (ids: string[]) =>
      storeIds
        .filter((id) => ids.includes(id))
        .map((telegramUserId) => ({
          telegramUserId,
          campaign_id: '1',
          business_id: '2',
          token: 't',
        })),
    ),
  };
  const config = { telegramAdminIds: adminIds };
  const errors = { report: vi.fn(async () => undefined) };
  return {
    errors,
    scheduler: new FinanceImportScheduler(
      queue as never,
      access as never,
      stores as never,
      config as never,
      errors as never,
      { connectedUsers: vi.fn(async () => new Set<string>()) } as never,
    ),
  };
}

const SELLER = { telegramUserId: '111', status: 'approved', features: { finance: true } };

describe('FinanceImportScheduler', () => {
  it('заводит одну задачу на продавца: id, cron, МСК, одна попытка, payload без дат', async () => {
    const queue = fakeQueue();
    const { scheduler } = build(queue, [SELLER], ['111']);

    expect(await scheduler.reconcile()).toEqual({ added: 1, removed: 0 });

    const [name, data, opts] = queue.add.mock.calls[0];
    expect(name).toBe(JOB_TYPES.IMPORT_FINANCE);
    expect(data).toEqual({ telegramUserId: '111', scheduled: true });
    expect(opts).toMatchObject({
      jobId: 'finance-111',
      repeat: { cron: financeCron('111'), tz: MOSCOW_TIME_ZONE },
      attempts: 1,
    });
  });

  it('рестарт не плодит вторую задачу', async () => {
    const queue = fakeQueue();
    const { scheduler } = build(queue, [SELLER], ['111']);

    await scheduler.reconcile();
    expect(await scheduler.reconcile()).toEqual({ added: 0, removed: 0 });
    expect(queue.repeatables.filter((j) => j.id === 'finance-111')).toHaveLength(1);
  });

  it('закрытая фича — задача снимается; чужие повторяемые не трогаются', async () => {
    const queue = fakeQueue([
      { id: 'finance-111', cron: financeCron('111') },
      { id: 'other-job', cron: '0 1 * * *' },
    ]);
    const { scheduler } = build(queue, [{ ...SELLER, features: { finance: false } }], ['111']);

    expect(await scheduler.reconcile()).toEqual({ added: 0, removed: 1 });
    expect(queue.repeatables.map((j) => j.id)).toEqual(['other-job']);
  });

  it('задача со старым cron пересоздаётся', async () => {
    const queue = fakeQueue([{ id: 'finance-111', cron: '0 0 * * *' }]);
    const { scheduler } = build(queue, [SELLER], ['111']);

    expect(await scheduler.reconcile()).toEqual({ added: 1, removed: 1 });
    expect(queue.repeatables).toMatchObject([{ id: 'finance-111', cron: financeCron('111') }]);
  });

  it('админ с магазином получает задачу без записи доступа', async () => {
    const queue = fakeQueue();
    const { scheduler } = build(queue, [], ['555'], [555]);

    await scheduler.reconcile();
    expect(queue.repeatables.map((j) => j.id)).toEqual(['finance-555']);
    expect(await scheduler.isEligible('555')).toBe(true);
    expect(await scheduler.isEligible('111')).toBe(false);
  });

  it('jobs() отдаёт только задачи загрузки', async () => {
    const queue = fakeQueue([
      { id: 'finance-111', cron: '7 4 * * *' },
      { id: 'hosting-reminder', cron: '0 10 28-31 * *' },
    ]);
    const { scheduler } = build(queue, [], []);
    expect(await scheduler.jobs()).toEqual([
      { telegramUserId: '111', cron: '7 4 * * *', tz: MOSCOW_TIME_ZONE, next: 1 },
    ]);
  });

  it('refresh не бросает: сбой Redis уходит в ErrorReporter', async () => {
    const queue = fakeQueue();
    queue.getRepeatableJobs.mockRejectedValueOnce(new Error('redis down'));
    const { scheduler, errors } = build(queue, [SELLER], ['111']);

    await expect(scheduler.refresh()).resolves.toBeUndefined();
    expect(errors.report).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'finance-import:schedule' }),
    );
  });
});
