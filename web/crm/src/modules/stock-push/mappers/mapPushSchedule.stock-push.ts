import type { PushInterval, PushSchedule, PushScheduleResponse } from '../stock-push.domain';

import { formatSavedAt } from '@/shared/utils/format';

const INTERVALS: readonly PushInterval[] = ['off', '30m', '1h', '3h', '6h'];

function intervalOf(value: string): PushInterval | null {
  return (INTERVALS as readonly string[]).includes(value) ? (value as PushInterval) : null;
}

/** Ответ сервера → вид. Незнакомый вариант (сервер новее фронта) не показывается. */
export function mapPushSchedule(raw: PushScheduleResponse, now: Date = new Date()): PushSchedule {
  const options: PushSchedule['options'] = [];
  for (const option of raw.options) {
    const value = intervalOf(option.value);
    if (value) options.push({ value, label: option.label });
  }
  const atLabel = raw.lastRun ? formatSavedAt(raw.lastRun.at, now) : null;
  return {
    interval: intervalOf(raw.interval) ?? '30m',
    intervalLabel: raw.intervalLabel,
    options,
    about: raw.about,
    nextRunLabel: raw.nextRunAt ? formatSavedAt(raw.nextRunAt, now) : null,
    lastRun:
      raw.lastRun && atLabel ? { atLabel, ok: raw.lastRun.ok, summary: raw.lastRun.summary } : null,
  };
}
