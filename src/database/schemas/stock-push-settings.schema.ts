import type { TPushInterval } from '../../modules/stock-push/stock-push-interval';

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

import { DEFAULT_PUSH_INTERVAL } from '../../modules/stock-push/stock-push-interval';

export type StockPushSettingsDocument = StockPushSettings & Document;

/**
 * Настройки «Передачи остатков» продавца: один документ на продавца, пока —
 * только частота прохода по расписанию (`stock_push_interval_by_seller`).
 * Нет документа — умолчание, поэтому продавцы до этой настройки миграции не ждут.
 */
@Schema({ timestamps: true })
export class StockPushSettings {
  @Prop({ type: String, required: true })
  telegramUserId: string;

  @Prop({ type: String, default: DEFAULT_PUSH_INTERVAL, required: true })
  interval: TPushInterval;

  createdAt?: Date;
  updatedAt?: Date;
}

export const StockPushSettingsSchema = SchemaFactory.createForClass(StockPushSettings);

StockPushSettingsSchema.index({ telegramUserId: 1 }, { unique: true });
