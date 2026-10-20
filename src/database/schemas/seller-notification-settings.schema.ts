import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SellerNotificationSettingsDocument = SellerNotificationSettings & Document;

/**
 * Настройки уведомлений продавца (TASK-152): один документ на продавца.
 *
 * Правила хранятся только те, что продавец менял: отсутствующее правило —
 * включено с порогом по умолчанию (`mergeRuleSettings`), поэтому новое правило
 * в коде не требует миграции. Время — «ЧЧ:ММ» по Москве, как у «⏰ Рассылки»
 * (`ReportSchedule`), и по той же причине не в UTC.
 */
@Schema({ timestamps: true })
export class SellerNotificationSettings {
  @Prop({ type: String, required: true })
  telegramUserId: string;

  /** Слать ли сводку в Telegram (действует только при открытой `notifications_telegram`). */
  @Prop({ type: Boolean, default: true, required: true })
  telegram: boolean;

  /** «ЧЧ:ММ» по Москве — когда проверять правила. */
  @Prop({ type: String, default: '09:00', required: true })
  time: string;

  /** `{ [rule]: { enabled, threshold } }` — только изменённые продавцом. */
  @Prop({ type: Object, default: {} })
  rules: Record<string, { enabled?: boolean; threshold?: number | null }>;

  createdAt?: Date;
  updatedAt?: Date;
}

export const SellerNotificationSettingsSchema = SchemaFactory.createForClass(
  SellerNotificationSettings,
);

SellerNotificationSettingsSchema.index({ telegramUserId: 1 }, { unique: true });
