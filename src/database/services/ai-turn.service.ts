import type { TAiTurnRating } from '../schemas/ai-turn.schema';

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { AiTurn, AiTurnDocument } from '../schemas/ai-turn.schema';

import { AI_EVAL_PURPOSE } from './ai-usage.service';

export interface IAiTurnRow {
  turnId: string;
  telegramUserId: string;
  purpose: string;
  numbers: number;
  unconfirmed: number;
  toolCalls: number;
  rounds: number;
  asksBackNoTools: boolean;
}

/** Счётчики одного разреза: ходы, из них с неподтверждёнными числами, уточняющих, оценённых, 👎. */
export interface IAiTurnQualityCounts {
  turns: number;
  withUnconfirmed: number;
  asksBackNoTools: number;
  rated: number;
  down: number;
}

export interface IAiTurnQuality {
  /** День — `ГГГГ-ММ-ДД` по Москве, как в `AiUsageService.summary`. */
  byDay: (IAiTurnQualityCounts & { day: string; purpose: string })[];
  byPurpose: (IAiTurnQualityCounts & { purpose: string })[];
}

const QUALITY_GROUP = {
  turns: { $sum: 1 },
  withUnconfirmed: { $sum: { $cond: [{ $gt: ['$unconfirmed', 0] }, 1, 0] } },
  asksBackNoTools: { $sum: { $cond: ['$asksBackNoTools', 1, 0] } },
  rated: { $sum: { $cond: [{ $in: ['$rating', ['up', 'down']] }, 1, 0] } },
  down: { $sum: { $cond: [{ $eq: ['$rating', 'down'] }, 1, 0] } },
};

const counts = (r: IAiTurnQualityCounts): IAiTurnQualityCounts => ({
  turns: r.turns,
  withUnconfirmed: r.withUnconfirmed,
  asksBackNoTools: r.asksBackNoTools,
  rated: r.rated,
  down: r.down,
});

@Injectable()
export class AiTurnService {
  private readonly logger = new Logger(AiTurnService.name);

  constructor(
    @InjectModel(AiTurn.name)
    private readonly model: Model<AiTurnDocument>,
  ) {}

  /** Записать счётчики хода. Не бросает (политика AiUsageService.record): ответ уже получен. */
  async record(row: IAiTurnRow): Promise<void> {
    try {
      await this.model.create({ ...row, rating: null, ratedAt: null });
    } catch (error) {
      this.logger.warn(
        `Не удалось записать счётчики хода ИИ (${row.telegramUserId}/${row.purpose}): ${(error as Error).message}`,
      );
    }
  }

  /**
   * Оценка продавца. Ход ищется вместе с владельцем и purpose: чужой и несуществующий
   * неразличимы (null → 404 у вызывающего). `$set` — повтор заменяет прежнюю оценку.
   */
  async rate(
    telegramUserId: string,
    turnId: string,
    purpose: string,
    rating: TAiTurnRating,
  ): Promise<boolean> {
    const updated = await this.model
      .findOneAndUpdate(
        { turnId, telegramUserId, purpose },
        { $set: { rating, ratedAt: new Date() } },
        { new: true },
      )
      .exec();
    return Boolean(updated);
  }

  /**
   * Доли качества за окно — ОДНИМ aggregate с $facet (довод AiUsageService.summary).
   * Без контрольного набора (`AI_EVAL_PURPOSE`): прогон владельца исказил бы доли.
   */
  async quality(since: Date, until: Date): Promise<IAiTurnQuality> {
    const [row] = await this.model
      .aggregate<{
        byDay: (IAiTurnQualityCounts & { _id: { day: string; purpose: string } })[];
        byPurpose: (IAiTurnQualityCounts & { _id: string })[];
      }>([
        { $match: { createdAt: { $gte: since, $lte: until }, purpose: { $ne: AI_EVAL_PURPOSE } } },
        {
          $facet: {
            byDay: [
              {
                $group: {
                  _id: {
                    day: {
                      $dateToString: {
                        format: '%Y-%m-%d',
                        date: '$createdAt',
                        timezone: 'Europe/Moscow',
                      },
                    },
                    purpose: '$purpose',
                  },
                  ...QUALITY_GROUP,
                },
              },
              { $sort: { '_id.day': -1, '_id.purpose': 1 } },
            ],
            byPurpose: [
              { $group: { _id: '$purpose', ...QUALITY_GROUP } },
              { $sort: { turns: -1 } },
            ],
          },
        },
      ])
      .exec();
    return {
      byDay: (row?.byDay ?? []).map((r) => ({
        day: r._id.day,
        purpose: r._id.purpose,
        ...counts(r),
      })),
      byPurpose: (row?.byPurpose ?? []).map((r) => ({ purpose: r._id, ...counts(r) })),
    };
  }
}
