import type { TPushInterval } from '../../modules/stock-push/stock-push-interval';

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

import { DEFAULT_PUSH_INTERVAL } from '../../modules/stock-push/stock-push-interval';

export type StockPushSettingsDocument = StockPushSettings & Document;

/**
 * Настройки «Передачи остатков» продавца: один документ на продавца — частота
 * прохода по расписанию (`stock_push_interval_by_seller`) и приём уведомлений
 * площадок о заказах (`stock_push_on_marketplace_event`).
 * Нет документа — умолчание, поэтому продавцы до этой настройки миграции не ждут.
 */
@Schema({ timestamps: true })
export class StockPushSettings {
  @Prop({ type: String, required: true })
  telegramUserId: string;

  @Prop({ type: String, default: DEFAULT_PUSH_INTERVAL, required: true })
  interval: TPushInterval;

  /**
   * Секрет адреса уведомлений `/api/webhooks/{ym|ozon}/<секрет>`: по нему находится
   * продавец, подписи у уведомлений ЯМ и Ozon нет. Заводится при первом показе в CRM.
   */
  @Prop({ type: String })
  webhookSecret?: string;

  /** Когда пришло последнее уведомление о заказе — по площадке; для экрана «работает ли». */
  @Prop({ type: Object, default: undefined })
  lastEventAt?: Partial<Record<'ym' | 'ozon', Date>>;

  createdAt?: Date;
  updatedAt?: Date;
}

export const StockPushSettingsSchema = SchemaFactory.createForClass(StockPushSettings);

StockPushSettingsSchema.index({ telegramUserId: 1 }, { unique: true });
StockPushSettingsSchema.index({ webhookSecret: 1 }, { unique: true, sparse: true });
