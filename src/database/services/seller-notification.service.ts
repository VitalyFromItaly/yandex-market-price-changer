import type {
  IActiveNotification,
  INotificationEvent,
  TNotificationRule,
} from '../../modules/notifications/notifications.domain';

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  SELLER_NOTIFICATION_KEEP_DAYS,
  SellerNotification,
  SellerNotificationDocument,
} from '../schemas/seller-notification.schema';

const DAY_MS = 86_400_000;

export interface ISellerNotificationRow {
  id: string;
  rule: string;
  marketplace: string | null;
  title: string;
  body: string;
  active: boolean;
  createdAt: Date | null;
  readAt: Date | null;
  sentAt: Date | null;
  resolvedAt: Date | null;
}

export interface ISellerNotificationPage {
  items: ISellerNotificationRow[];
  total: number;
  /** Непрочитанных у продавца — независимо от фильтра. */
  unread: number;
}

/**
 * Лента уведомлений и состояние дедупа (TASK-152). Все запросы — по
 * telegramUserId продавца: чужие уведомления не видны даже случайно.
 */
@Injectable()
export class SellerNotificationService {
  constructor(
    @InjectModel(SellerNotification.name)
    private readonly model: Model<SellerNotificationDocument>,
  ) {}

  async listActive(telegramUserId: string): Promise<IActiveNotification[]> {
    const docs = await this.model.find({ telegramUserId, active: true }).lean().exec();
    return docs.map((doc) => ({
      rule: doc.rule as TNotificationRule,
      subjectKey: doc.subjectKey,
      fingerprint: doc.fingerprint,
    }));
  }

  /**
   * Снять пропавшие и записать новые. Снятие — раньше вставки: смена состояния
   * снимает прежнее уведомление того же предмета и сразу пишет новое.
   */
  async apply(
    telegramUserId: string,
    toResolve: readonly IActiveNotification[],
    toCreate: readonly INotificationEvent[],
    now: Date,
  ): Promise<ISellerNotificationRow[]> {
    const expireAt = new Date(now.getTime() + SELLER_NOTIFICATION_KEEP_DAYS * DAY_MS);
    for (const row of toResolve) {
      await this.model
        .updateMany(
          { telegramUserId, active: true, rule: row.rule, subjectKey: row.subjectKey },
          { $set: { active: false, resolvedAt: now, expireAt } },
        )
        .exec();
    }
    if (!toCreate.length) return [];
    const created = await this.model.insertMany(
      toCreate.map((event) => ({
        telegramUserId,
        rule: event.rule,
        subjectKey: event.subjectKey,
        fingerprint: event.fingerprint,
        marketplace: event.marketplace,
        title: event.title,
        body: event.body,
        active: true,
        readAt: null,
        sentAt: null,
        resolvedAt: null,
        expireAt: null,
      })),
    );
    return created.map(rowOf);
  }

  async list(
    telegramUserId: string,
    options: { unreadOnly?: boolean; skip?: number; limit?: number } = {},
  ): Promise<ISellerNotificationPage> {
    const filter = options.unreadOnly ? { telegramUserId, readAt: null } : { telegramUserId };
    const [docs, total, unread] = await Promise.all([
      this.model
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(options.skip ?? 0)
        .limit(options.limit ?? 50)
        .lean()
        .exec(),
      this.model.countDocuments(filter).exec(),
      this.model.countDocuments({ telegramUserId, readAt: null }).exec(),
    ]);
    return { items: docs.map(rowOf), total, unread };
  }

  /** Отметить прочитанными: список id или все непрочитанные продавца. */
  async markRead(
    telegramUserId: string,
    ids: readonly string[] | 'all',
    now: Date,
  ): Promise<number> {
    const filter =
      ids === 'all'
        ? { telegramUserId, readAt: null }
        : { telegramUserId, readAt: null, _id: { $in: [...ids] } };
    const result = await this.model.updateMany(filter, { $set: { readAt: now } }).exec();
    return result.modifiedCount;
  }

  async markSent(telegramUserId: string, ids: readonly string[], now: Date): Promise<void> {
    if (!ids.length) return;
    await this.model
      .updateMany({ telegramUserId, _id: { $in: [...ids] } }, { $set: { sentAt: now } })
      .exec();
  }
}

function rowOf(doc: SellerNotification & { _id?: unknown }): ISellerNotificationRow {
  return {
    id: String(doc._id),
    rule: doc.rule,
    marketplace: doc.marketplace ?? null,
    title: doc.title,
    body: doc.body,
    active: doc.active,
    createdAt: doc.createdAt ?? null,
    readAt: doc.readAt ?? null,
    sentAt: doc.sentAt ?? null,
    resolvedAt: doc.resolvedAt ?? null,
  };
}
