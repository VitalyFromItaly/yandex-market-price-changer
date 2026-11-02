import type { PushScheduleResponse } from '../stock-push.domain';

import { describe, expect, it } from 'vitest';

import { mapPushSchedule } from './mapPushSchedule.stock-push';

function raw(overrides: Partial<PushScheduleResponse> = {}): PushScheduleResponse {
  return {
    interval: '1h',
    intervalLabel: 'каждый час',
    options: [
      { value: '30m', label: 'каждые 30 минут' },
      { value: '15m', label: 'каждые 15 минут' },
      { value: 'off', label: 'выключена' },
    ],
    about: ['Зачем'],
    nextRunAt: '2026-11-02T12:00:00Z',
    lastRun: { at: '2026-11-02T11:00:00Z', ok: false, summary: 'записано 3 из 4' },
    ...overrides,
  };
}

describe('mapPushSchedule', () => {
  const now = new Date('2026-11-02T11:10:00Z');

  it('время по Москве, незнакомые варианты не показываются', () => {
    const view = mapPushSchedule(raw(), now);
    expect(view.interval).toBe('1h');
    expect(view.options.map((o) => o.value)).toEqual(['30m', 'off']);
    expect(view.nextRunLabel).toBe('15:00');
    expect(view.lastRun).toEqual({ atLabel: '14:00', ok: false, summary: 'записано 3 из 4' });
  });

  it('без запусков — null; незнакомая частота — умолчание', () => {
    const view = mapPushSchedule(raw({ interval: 'weird', nextRunAt: null, lastRun: null }), now);
    expect(view.interval).toBe('30m');
    expect(view.nextRunLabel).toBeNull();
    expect(view.lastRun).toBeNull();
  });
});
