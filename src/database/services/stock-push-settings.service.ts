import type { TPushInterval } from '../../modules/stock-push/stock-push-interval';

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  DEFAULT_PUSH_INTERVAL,
  isPushInterval,
} from '../../modules/stock-push/stock-push-interval';
import {
  StockPushSettings,
  StockPushSettingsDocument,
} from '../schemas/stock-push-settings.schema';

/** Частота передачи остатков продавца. Все запросы — по telegramUserId. */
@Injectable()
export class StockPushSettingsService {
  constructor(
    @InjectModel(StockPushSettings.name)
    private readonly model: Model<StockPushSettingsDocument>,
  ) {}

  async intervalOf(telegramUserId: string): Promise<TPushInterval> {
    const doc = await this.model.findOne({ telegramUserId }).lean().exec();
    return isPushInterval(doc?.interval) ? doc.interval : DEFAULT_PUSH_INTERVAL;
  }

  /** Частота всех продавцов, у кого есть документ, — для сверки расписания одним запросом. */
  async intervalsFor(telegramUserIds: readonly string[]): Promise<Map<string, TPushInterval>> {
    if (!telegramUserIds.length) return new Map();
    const docs = await this.model
      .find({ telegramUserId: { $in: [...telegramUserIds] } })
      .lean()
      .exec();
    return new Map(
      docs.map((doc) => [
        doc.telegramUserId,
        isPushInterval(doc.interval) ? doc.interval : DEFAULT_PUSH_INTERVAL,
      ]),
    );
  }

  /** Значение уже проверено вызывающим. */
  async setInterval(telegramUserId: string, interval: TPushInterval): Promise<TPushInterval> {
    await this.model
      .findOneAndUpdate(
        { telegramUserId },
        { $set: { interval }, $setOnInsert: { telegramUserId } },
        { upsert: true, new: true },
      )
      .exec();
    return interval;
  }
}
