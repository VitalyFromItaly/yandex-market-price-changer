import type {
  TCardIssueReason,
  TMarketplace,
  TMatchLevel,
} from '../../modules/products/product.domain';

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ProductCardIssueDocument = ProductCardIssue & Document;

/**
 * Карточка площадки, не привязанная к товару, и причина (TASK-117): очередь
 * «не сопоставлено».
 *
 * Строки двух родов:
 *  - находки прохода (`conflict`, `shared`, `sku_taken`, `no_match`) — вывод,
 *    а не событие: каждый проход заменяет их целиком, и находка, которую
 *    закрыл новый товар или привязка, исчезает (довод `replacePeriod`);
 *  - `manual_unlink` — решение админа. Проход их не трогает и сам эту карточку
 *    больше не привязывает. Снимает строку только ручная привязка.
 *
 * Сама карточка в базе не хранится — только её артикул и название для экрана:
 * источник карточек — площадка, вторая копия каталога разошлась бы с ней.
 */
@Schema({ timestamps: true })
export class ProductCardIssue {
  @Prop({ type: String, required: true })
  telegramUserId: string;

  @Prop({ type: String, required: true })
  marketplace: TMarketplace;

  /** Артикул карточки на площадке (у ЯМ — offerId). */
  @Prop({ type: String, required: true })
  sku: string;

  @Prop({ type: String })
  name?: string;

  @Prop({ type: String, required: true })
  reason: TCardIssueReason;

  /** На каком уровне сопоставления случился конфликт. */
  @Prop({ type: String })
  level?: TMatchLevel;

  /** Id товаров-кандидатов (строкой, без ref — как `CostHistory.productId`). */
  @Prop({ type: [String], default: [] })
  candidateIds: string[];

  @Prop({ type: Date, required: true })
  detectedAt: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const ProductCardIssueSchema = SchemaFactory.createForClass(ProductCardIssue);

// Одна строка на карточку: у карточки одна причина в каждый момент.
ProductCardIssueSchema.index({ telegramUserId: 1, marketplace: 1, sku: 1 }, { unique: true });

// Экран очереди: свежие сверху.
ProductCardIssueSchema.index({ telegramUserId: 1, detectedAt: -1 });
