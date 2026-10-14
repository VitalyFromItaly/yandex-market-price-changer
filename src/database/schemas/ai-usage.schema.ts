import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AiUsageDocument = AiUsage & Document;

/** Сколько хранить учёт ИИ-запросов. Смена числа — `npm run db:sync-indexes`. */
export const AI_USAGE_TTL_DAYS = 180;

export type TAiUsageStatus = 'ok' | 'error';

/**
 * Один ИИ-запрос к Polza.ai: кто, зачем, какой моделью, сколько токенов и рублей.
 *
 * Ключ Polza один на всех, платит владелец — расход должен быть виден по каждому
 * запросу. Строка пишется и на упавший запрос: «почему у продавца не работает ИИ»
 * без неё не отвечается.
 *
 * Текста промпта и ответа здесь НЕТ намеренно: это переписка продавца с его
 * покупателями и его данные о товарах. Учёту расхода текст не нужен, а копия
 * в базе — вторая копия чужих данных (довод maskSecrets в журнале действий).
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false }, versionKey: false })
export class AiUsage {
  @Prop({ type: String, required: true })
  telegramUserId: string;

  /** Где в продукте спросили: `feedback-reply`, `check`… */
  @Prop({ type: String, required: true })
  purpose: string;

  /** Запрошенная модель (POLZA_AI_MODEL или явная в запросе). */
  @Prop({ type: String, default: '' })
  model: string;

  /** Модель, которую назвал ответ. Пусто у упавшего запроса. */
  @Prop({ type: String, default: '' })
  responseModel: string;

  @Prop({ type: String, default: '' })
  provider: string;

  @Prop({ type: Number, default: 0 })
  promptTokens: number;

  @Prop({ type: Number, default: 0 })
  completionTokens: number;

  @Prop({ type: Number, default: 0 })
  totalTokens: number;

  @Prop({ type: Number, default: 0 })
  cachedTokens: number;

  @Prop({ type: Number, default: 0 })
  reasoningTokens: number;

  /** usage.cost_rub ответа как есть, без пересчёта. Упавший запрос Polza не тарифицирует — 0. */
  @Prop({ type: Number, default: 0 })
  costRub: number;

  @Prop({ type: Number, default: 0 })
  durationMs: number;

  /** id ответа (gen_…) или trace_id ошибки — по нему запрос находится у Polza. */
  @Prop({ type: String, default: '' })
  traceId: string;

  @Prop({ type: String, enum: ['ok', 'error'], required: true })
  status: TAiUsageStatus;

  /** null — ответа не было (сеть, таймаут) или запрос успешен. */
  @Prop({ type: Number, default: null })
  httpStatus: number | null;

  @Prop({ type: String, default: null })
  errorCode: string | null;

  createdAt?: Date;
}

export const AiUsageSchema = SchemaFactory.createForClass(AiUsage);

// Сумма costRub за московский день — по продавцу и времени.
AiUsageSchema.index({ telegramUserId: 1, createdAt: -1 });
// И TTL, и сортировка «последние запросы».
AiUsageSchema.index({ createdAt: -1 }, { expireAfterSeconds: AI_USAGE_TTL_DAYS * 24 * 60 * 60 });
