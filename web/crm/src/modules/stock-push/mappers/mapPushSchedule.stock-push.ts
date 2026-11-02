import type {
  EventMarketplace,
  PushEvents,
  PushEventsResponse,
  PushInterval,
  PushSchedule,
  PushScheduleResponse,
} from '../stock-push.domain';

import { formatSavedAt } from '@/shared/utils/format';

const INTERVALS: readonly PushInterval[] = ['off', '30m', '1h', '3h', '6h'];

function intervalOf(value: string): PushInterval | null {
  return (INTERVALS as readonly string[]).includes(value) ? (value as PushInterval) : null;
}

function mapEvents(raw: PushEventsResponse | undefined, now: Date): PushEvents | null {
  if (!raw) return null;
  const targets: PushEvents['targets'] = [];
  for (const target of raw.targets) {
    if (target.marketplace !== 'ym' && target.marketplace !== 'ozon') continue;
    targets.push({
      marketplace: target.marketplace as EventMarketplace,
      title: target.title,
      url: target.url,
      steps: target.steps,
      lastEventLabel: target.lastEventAt ? formatSavedAt(target.lastEventAt, now) : null,
    });
  }
  return { about: raw.about, unavailable: raw.unavailable, targets };
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
    events: mapEvents(raw.events, now),
  };
}
