import type { IApiBucket, TApiOutcome } from '../../metrics/metrics.domain';

import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';

import { TelegramApiBucketService } from '../../../database/services/telegram-api-bucket.service';
import {
  MINUTE_MS,
  emptyHistogram,
  floorTo,
  latencyBucketIndex,
} from '../../metrics/metrics.domain';

/** Как часто сливать накопленное в Mongo. */
export const METRICS_FLUSH_INTERVAL_MS = MINUTE_MS;

/**
 * Потолок бакетов в памяти. Ключ — (минута, бот, метод, исход), и при живой
 * базе за минуту их десятки. Потолок нужен на случай, когда база лежит часами:
 * сбой слива сбрасывает накопленное, но и без этого память не должна расти
 * бесконечно, если слив почему-то перестал вызываться.
 */
const MAX_PENDING_BUCKETS = 5000;

/**
 * Счётчик вызовов Bot API: метод, исход, задержка.
 *
 * Наблюдение приходит из единой воронки `callApi` (BotRegistry.installOutgoingLog)
 * — ВСЕ методы, включая getMe/getUpdates/setMyCommands, которых журнал
 * исходящих не видит. Копится в памяти по минутам и раз в минуту сливается
 * `$inc`-ом: строка на вызов под polling превратила бы коллекцию в ленту
 * getUpdates.
 *
 * `observe` синхронный и не бросает: метрика не имеет права замедлить или
 * сломать ответ пользователю.
 *
 * setInterval, а не Bull, — довод HealthMonitorService: репит в Redis не
 * выполнился бы ровно при той аварии, которую метрика должна показать.
 */
@Injectable()
export class TelegramApiMetrics implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TelegramApiMetrics.name);
  private pending = new Map<string, IApiBucket & { lat: number[] }>();
  private timer?: NodeJS.Timeout;

  constructor(private readonly buckets: TelegramApiBucketService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.flush(), METRICS_FLUSH_INTERVAL_MS);
  }

  /** Последний слив — иначе минута перед редеплоем терялась бы всегда. */
  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.flush();
  }

  public observe(
    botId: string,
    method: string,
    outcome: TApiOutcome,
    ms: number,
    now = Date.now(),
  ): void {
    try {
      const minute = floorTo(now, MINUTE_MS);
      const key = `${minute}|${botId}|${method}|${outcome}`;
      let bucket = this.pending.get(key);

      if (!bucket) {
        if (this.pending.size >= MAX_PENDING_BUCKETS) return;
        bucket = {
          minute,
          botId,
          method,
          outcome,
          count: 0,
          sumMs: 0,
          maxMs: 0,
          lat: emptyHistogram(),
        };
        this.pending.set(key, bucket);
      }

      const duration = Math.max(0, Math.round(ms));
      bucket.count += 1;
      bucket.sumMs += duration;
      bucket.maxMs = Math.max(bucket.maxMs, duration);
      bucket.lat[latencyBucketIndex(duration)] += 1;
    } catch (error) {
      this.logger.warn(`Метрика вызова ${method} не учтена: ${(error as Error).message}`);
    }
  }

  /**
   * Слить накопленное. Сбой — строка в лог и СБРОС: копить в памяти до
   * возвращения базы нельзя (она может не вернуться часами), а о самой аварии
   * базы и так кричит самопроверка. Потерянные минуты видны на графике дырой.
   */
  public async flush(): Promise<void> {
    if (this.pending.size === 0) return;

    const batch = [...this.pending.values()];
    this.pending = new Map();

    try {
      await this.buckets.flush(batch);
    } catch (error) {
      this.logger.warn(
        `Метрики Telegram API за ${batch.length} бакетов не записаны: ${(error as Error).message}`,
      );
    }
  }
}
