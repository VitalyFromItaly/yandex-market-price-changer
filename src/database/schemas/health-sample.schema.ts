import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type HealthSampleDocument = HealthSample & Document;

/** Сколько хранить образцы самопроверки. Смена числа — `npm run db:sync-indexes`. */
export const HEALTH_SAMPLE_TTL_DAYS = 30;

/**
 * Один образец самопроверки: что проверяли, чем кончилось и сколько заняло.
 *
 * Зачем история, если монитор и так алертит. Алерт срабатывает, когда зеркало
 * TELEGRAM_API_URL уже не отвечает; деградация до этого — getMe за 3 секунды
 * вместо 200 мс — без истории не видна вовсе. 288 строк в сутки на проверку.
 */
@Schema({ timestamps: false, versionKey: false })
export class HealthSample {
  @Prop({ type: Date, required: true })
  at: Date;

  /** Ключ проверки: disk | mongo | redis | telegram | yandex. */
  @Prop({ type: String, required: true })
  key: string;

  /** ok | warn | down. */
  @Prop({ type: String, required: true })
  state: string;

  /** null — у проверки нет сетевой задержки (диск, Mongo по readyState). */
  @Prop({ type: Number, default: null })
  latencyMs: number | null;
}

export const HealthSampleSchema = SchemaFactory.createForClass(HealthSample);

HealthSampleSchema.index({ key: 1, at: 1 });
HealthSampleSchema.index({ at: 1 }, { expireAfterSeconds: HEALTH_SAMPLE_TTL_DAYS * 24 * 60 * 60 });
