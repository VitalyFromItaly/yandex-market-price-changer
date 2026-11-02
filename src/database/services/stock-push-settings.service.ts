import type { TPushInterval } from '../../modules/stock-push/stock-push-interval';

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomBytes } from 'node:crypto';

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

  /**
   * Секрет адреса уведомлений; нет — заводится. `$setOnInsert`/фильтр по отсутствию
   * поля — два открытых окна CRM не перетрут секрет друг другу.
   */
  async ensureWebhookSecret(telegramUserId: string): Promise<string> {
    const existing = await this.model.findOne({ telegramUserId }).lean().exec();
    if (existing?.webhookSecret) return existing.webhookSecret;
    await this.model
      .findOneAndUpdate(
        { telegramUserId, webhookSecret: { $exists: false } },
        {
          $set: { webhookSecret: randomBytes(24).toString('hex') },
          $setOnInsert: { telegramUserId },
        },
        { upsert: true, new: true },
      )
      .exec()
      .catch((error: { code?: number }) => {
        // Дубль ключа: документ есть и секрет уже поставил соседний запрос.
        if (error?.code !== 11000) throw error;
      });
    const doc = await this.model.findOne({ telegramUserId }).lean().exec();
    return doc.webhookSecret;
  }

  /** Продавец по секрету адреса уведомлений; null — чужой или устаревший адрес. */
  async findBySecret(
    secret: string,
  ): Promise<{ telegramUserId: string; lastEventAt: Partial<Record<'ym' | 'ozon', Date>> } | null> {
    if (!/^[0-9a-f]{48}$/.test(secret)) return null;
    const doc = await this.model.findOne({ webhookSecret: secret }).lean().exec();
    return doc ? { telegramUserId: doc.telegramUserId, lastEventAt: doc.lastEventAt ?? {} } : null;
  }

  async lastEventsOf(telegramUserId: string): Promise<Partial<Record<'ym' | 'ozon', Date>>> {
    const doc = await this.model.findOne({ telegramUserId }).lean().exec();
    return doc?.lastEventAt ?? {};
  }

  async markEvent(telegramUserId: string, marketplace: 'ym' | 'ozon', at: Date): Promise<void> {
    await this.model
      .updateOne({ telegramUserId }, { $set: { [`lastEventAt.${marketplace}`]: at } })
      .exec();
  }

  /**
   * Новый секрет адреса (продавец сменил адрес в CRM): старый перестаёт работать
   * сразу. `previous` — чтобы перенастроить подписку Ozon, подключённую отсюда.
   */
  async rotateWebhookSecret(
    telegramUserId: string,
  ): Promise<{ previous: string | null; secret: string }> {
    const before = await this.model.findOne({ telegramUserId }).lean().exec();
    const secret = randomBytes(24).toString('hex');
    await this.model
      .findOneAndUpdate(
        { telegramUserId },
        { $set: { webhookSecret: secret }, $setOnInsert: { telegramUserId } },
        { upsert: true, new: true },
      )
      .exec();
    return { previous: before?.webhookSecret ?? null, secret };
  }
}
