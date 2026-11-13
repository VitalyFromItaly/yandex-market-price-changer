import type { SyncPeriodResponse, SyncResponse } from '../accounting.domain';

import { describe, expect, it } from 'vitest';

import { mapSync, mapSyncPeriod, monthLabel } from './mapSync.accounting';

const NOW = new Date('2026-11-08T12:00:00Z');

const period = (over: Partial<SyncPeriodResponse> = {}): SyncPeriodResponse => ({
  month: '2026-11',
  from: '2026-11-01',
  to: '2026-11-30',
  lastAttemptAt: '2026-11-08T09:00:00Z',
  outcome: 'imported',
  outcomeLabel: 'Загружено',
  trigger: 'frequent',
  triggerLabel: 'Текущий период',
  attempt: 1,
  error: null,
  lastSuccessAt: '2026-11-08T09:00:00Z',
  missed: false,
  ...over,
});

describe('mapSync', () => {
  it('месяц словами', () => {
    expect(monthLabel('2026-10')).toBe('Октябрь 2026');
  });

  it('успех — «данные на» время последнего успеха, сегодня — только время', () => {
    const row = mapSyncPeriod(period(), NOW);
    expect(row).toMatchObject({
      tone: 'ok',
      statusLabel: 'Загружено',
      successLabel: 'данные на 12:00',
    });
    expect(row.attemptLabel).toBe('Попытка 12:00 · текущий период');
  });

  it('сбой: последний успех не затёрт, ошибка и номер попытки видны', () => {
    const row = mapSyncPeriod(
      period({
        outcome: 'failed',
        outcomeLabel: 'Сбой',
        trigger: 'retry',
        triggerLabel: 'Повтор после сбоя',
        attempt: 3,
        error: 'HTTP 500',
        lastAttemptAt: '2026-11-08T11:00:00Z',
        lastSuccessAt: '2026-11-07T09:00:00Z',
      }),
      NOW,
    );
    expect(row).toMatchObject({ tone: 'failed', statusLabel: 'Сбой', error: 'HTTP 500' });
    expect(row.successLabel).toBe('данные на 07-11-2026 12:00');
    expect(row.attemptLabel).toBe('Попытка 14:00 · повтор после сбоя, попытка 3');
  });

  it('пропуск: не грузился вовсе — «ещё не загружался»', () => {
    const row = mapSyncPeriod(
      period({
        lastAttemptAt: null,
        outcome: null,
        outcomeLabel: null,
        trigger: null,
        triggerLabel: null,
        attempt: null,
        lastSuccessAt: null,
        missed: true,
      }),
      NOW,
    );
    expect(row).toMatchObject({
      tone: 'idle',
      attemptLabel: null,
      successLabel: 'успешной загрузки не было',
    });
  });

  it('раздел: «Данные на» только если у всех площадок был успех', () => {
    const response: SyncResponse = {
      asOf: '2026-11-08T09:00:00Z',
      everyHours: 3,
      reloadMonths: 3,
      marketplaces: [
        {
          marketplace: 'ym',
          label: 'Яндекс Маркет',
          lastSuccessAt: '2026-11-08T09:00:00Z',
          periods: [period(), period({ month: '2026-10', missed: true, outcome: 'failed' })],
        },
      ],
    };
    const view = mapSync(response, NOW);
    expect(view.asOfLabel).toBe('Данные на 12:00');
    expect(view.marketplaces[0]).toMatchObject({ asOfLabel: 'данные на 12:00', missedCount: 1 });
    expect(view.scheduleLabel).toContain('каждые 3 ч');
    expect(mapSync({ ...response, asOf: null }, NOW).asOfLabel).toBeNull();
  });
});
