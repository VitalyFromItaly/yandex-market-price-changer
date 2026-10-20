import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SellerNotificationDocument = SellerNotification & Document;

/** Сколько хранить снятое уведомление: центр показывает историю, а не архив. */
export const SELLER_NOTIFICATION_KEEP_DAYS = 90;

/**
 * Уведомление продавцу (TASK-152) — и запись центра уведомлений, и состояние
 * дедупа: активное (`active: true`) уведомление по (правило, предмет) значит
 * «уже сказали, до смены состояния не повторять». Снятое (`active: false`)
 * остаётся в ленте до `expireAt`.
 *
 * Текст сохраняется готовым (`notifications.text.ts`): лента показывает то,
 * что было сказано в момент события, а не пересчёт сегодняшних чисел.
 */
@Schema({ timestamps: true })
export class SellerNotification {
  @Prop({ type: String, required: true })
  telegramUserId: string;

  @Prop({ type: String, required: true })
  rule: string;

  @Prop({ type: String, required: true })
  subjectKey: string;

  @Prop({ type: String, required: true })
  fingerprint: string;

  /** Площадка события; null — у события нет площадки (склад, налог). */
  @Prop({ type: String, default: null })
  marketplace: string | null;

  @Prop({ type: String, required: true })
  title: string;

  @Prop({ type: String, required: true })
  body: string;

  @Prop({ type: Boolean, default: true, required: true })
  active: boolean;

  @Prop({ type: Date, default: null })
  readAt: Date | null;

  /** Когда ушло в Telegram; null — не уходило (фича закрыта, выключено, сбой отправки). */
  @Prop({ type: Date, default: null })
  sentAt: Date | null;

  @Prop({ type: Date, default: null })
  resolvedAt: Date | null;

  /** Ставится при снятии; TTL-индекс удаляет документ в этот момент. Активные не истекают. */
  @Prop({ type: Date, default: null })
  expireAt: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const SellerNotificationSchema = SchemaFactory.createForClass(SellerNotification);

// Лента продавца — свежие сверху.
SellerNotificationSchema.index({ telegramUserId: 1, createdAt: -1 });
// Состояние дедупа: активные по продавцу.
SellerNotificationSchema.index({ telegramUserId: 1, active: 1, rule: 1, subjectKey: 1 });
// Снятые уходят через SELLER_NOTIFICATION_KEEP_DAYS; срок меняется в коде, а не в индексе
// (expireAfterSeconds: 0 — удалить в момент expireAt).
SellerNotificationSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });
