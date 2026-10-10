import type { IApiSummary, IBotSummary, IProbeSummary, TMetricsRange } from './metrics.domain';

import { Injectable } from '@nestjs/common';

import { ActionLogService } from '../../database/services/action-log.service';
import { HealthSampleService } from '../../database/services/health-sample.service';
import { TelegramApiBucketService } from '../../database/services/telegram-api-bucket.service';
import { ACTION_KINDS } from '../telegram/bots/shared/action-log.domain';

import {
  METRICS_RANGES,
  summarizeApi,
  summarizeProbe,
  summarizeUpdates,
  timelineSlots,
  timelineStep,
} from './metrics.domain';

/** Сетевые проверки самопроверки, у которых есть задержка. */
const PROBE_KEYS = ['telegram', 'yandex', 'redis'] as const;

/** Сколько последних неудачных вызовов Bot API показывать списком. */
const RECENT_ERRORS_LIMIT = 20;

export interface IMetricsReport {
  range: TMetricsRange;
  since: number;
  until: number;
  step: number;
  telegram: IApiSummary & {
    recentErrors: {
      at: number;
      telegramUserId: string;
      method: string;
      code: number | null;
      error: string;
    }[];
  };
  probes: IProbeSummary[];
  bot: IBotSummary;
}

/**
 * Сводка для страницы «Метрики»: Telegram API, задержка зеркала, работа бота.
 *
 * Только чтение и свёртка. Три источника читаются параллельно, арифметика —
 * в metrics.domain.ts.
 */
@Injectable()
export class MetricsService {
  constructor(
    private readonly buckets: TelegramApiBucketService,
    private readonly samples: HealthSampleService,
    private readonly logs: ActionLogService,
  ) {}

  async report(range: TMetricsRange, now = Date.now()): Promise<IMetricsReport> {
    const since = now - METRICS_RANGES[range];
    const step = timelineStep(range);
    const slots = timelineSlots(since, now, step);
    const sinceDate = new Date(since);

    const [buckets, probeRows, updates, errors] = await Promise.all([
      this.buckets.findSince(sinceDate),
      this.samples.findSince(sinceDate, PROBE_KEYS),
      this.logs.findUpdatesSince(sinceDate, ACTION_KINDS),
      this.logs.recentTelegramErrors(sinceDate, RECENT_ERRORS_LIMIT),
    ]);

    return {
      range,
      since,
      until: now,
      step,
      telegram: {
        ...summarizeApi(buckets, slots, step),
        recentErrors: errors.map((row) => ({
          at: row.createdAt ? new Date(row.createdAt).getTime() : 0,
          telegramUserId: row.telegramUserId,
          method: (row.context ?? '').replace(/^send:/, ''),
          code: row.httpStatus ?? null,
          error: row.error ?? '',
        })),
      },
      probes: PROBE_KEYS.map((key) => summarizeProbe(key, probeRows, slots, step)),
      bot: summarizeUpdates(updates, slots, step),
    };
  }
}
