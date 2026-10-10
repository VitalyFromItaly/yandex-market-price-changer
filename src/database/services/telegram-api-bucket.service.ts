import type { IApiBucket } from '../../modules/metrics/metrics.domain';

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  TelegramApiBucket,
  TelegramApiBucketDocument,
} from '../schemas/telegram-api-bucket.schema';

@Injectable()
export class TelegramApiBucketService {
  constructor(
    @InjectModel(TelegramApiBucket.name)
    private readonly model: Model<TelegramApiBucketDocument>,
  ) {}

  /**
   * Слить накопленные бакеты одним bulkWrite.
   *
   * `$inc`, а не `$set`: одну минуту могут слить дважды (таймер и остановка
   * приложения), и второй слив должен прибавиться, а не затереть первый.
   * Гистограмма — тоже `$inc`, по путям `lat.<i>`, поэтому в базе она объект
   * (см. схему), а читатель приводит её к массиву.
   *
   * Бросает — решать, что делать со сбоем, вызывающему.
   */
  async flush(buckets: readonly IApiBucket[]): Promise<void> {
    if (buckets.length === 0) return;

    await this.model.bulkWrite(
      buckets.map((bucket) => {
        const inc: Record<string, number> = { count: bucket.count, sumMs: bucket.sumMs };
        bucket.lat.forEach((value, index) => {
          if (value > 0) inc[`lat.${index}`] = value;
        });

        return {
          updateOne: {
            filter: {
              minute: new Date(bucket.minute),
              botId: bucket.botId,
              method: bucket.method,
              outcome: bucket.outcome,
            },
            update: { $inc: inc, $max: { maxMs: bucket.maxMs } },
            upsert: true,
          },
        };
      }),
      { ordered: false },
    );
  }

  /** Все бакеты окна. lat приводится к массиву — в базе он объект (см. flush). */
  async findSince(since: Date): Promise<IApiBucket[]> {
    const rows = await this.model
      .find({ minute: { $gte: since } })
      .select({
        _id: 0,
        minute: 1,
        botId: 1,
        method: 1,
        outcome: 1,
        count: 1,
        sumMs: 1,
        maxMs: 1,
        lat: 1,
      })
      .lean<(Omit<IApiBucket, 'lat'> & { lat?: unknown })[]>()
      .exec();

    return rows.map((row) => ({ ...row, lat: latArray(row.lat) }));
  }
}

/** `{ '0': 3, '5': 1 }` или `[3, 0, …]` → массив; мусор — пустой. */
export function latArray(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw.map((value) => Number(value) || 0);
  if (!raw || typeof raw !== 'object') return [];

  const result: number[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const index = Number(key);
    if (Number.isInteger(index) && index >= 0 && index < 64) result[index] = Number(value) || 0;
  }
  return Array.from(result, (value) => value ?? 0);
}
