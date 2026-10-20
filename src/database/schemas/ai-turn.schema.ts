import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

import { AI_USAGE_TTL_DAYS } from './ai-usage.schema';

export type AiTurnDocument = AiTurn & Document;

export type TAiTurnRating = 'up' | 'down';

/**
 * Один ход ИИ в CRM (вопрос аналитику, разбор периода): счётчики качества ответа
 * и оценка продавца 👍/👎.
 *
 * Документ на ход, а не поля на строке AiUsage последнего раунда: строка AiUsage
 * пишется внутри раунда «выстрелил и забыл», а счётчики известны только после
 * проверки чисел ответа — доапдейт гонялся бы с ещё не вставленной строкой.
 * Ход в памяти CRM живёт 10 минут, а оценку ставят и позже — владение
 * проверяется по этому документу.
 *
 * Текста вопроса и ответа здесь НЕТ (правило AiUsage, TASK-104): только числа и флаги.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false }, versionKey: false })
export class AiTurn {
  /** id хода CRM (`InMemoryTurns`) — его же видит фронт. */
  @Prop({ type: String, required: true })
  turnId: string;

  @Prop({ type: String, required: true })
  telegramUserId: string;

  /** Тот же purpose, что у строк AiUsage хода: `analyst`, `period-review`. */
  @Prop({ type: String, required: true })
  purpose: string;

  /** Чисел в ответе, которые сверяются с данными (годы, даты, мелкие счёты — нет). */
  @Prop({ type: Number, default: 0 })
  numbers: number;

  /** Из них не нашлось в данных инструментов / фактах разбора. */
  @Prop({ type: Number, default: 0 })
  unconfirmed: number;

  @Prop({ type: Number, default: 0 })
  toolCalls: number;

  /** Раундов к Polza — столько же строк AiUsage. */
  @Prop({ type: Number, default: 0 })
  rounds: number;

  /** Ответ — уточняющий вопрос без единого вызова инструмента (эвристика `asksBack`). */
  @Prop({ type: Boolean, default: false })
  asksBackNoTools: boolean;

  /** Оценка продавца; повторная заменяет прежнюю. */
  @Prop({ type: String, enum: ['up', 'down', null], default: null })
  rating: TAiTurnRating | null;

  @Prop({ type: Date, default: null })
  ratedAt: Date | null;

  createdAt?: Date;
}

export const AiTurnSchema = SchemaFactory.createForClass(AiTurn);

AiTurnSchema.index({ turnId: 1 }, { unique: true });
// TTL — тот же срок, что у учёта запросов: доли без строк журнала не проверить.
AiTurnSchema.index({ createdAt: -1 }, { expireAfterSeconds: AI_USAGE_TTL_DAYS * 24 * 60 * 60 });
