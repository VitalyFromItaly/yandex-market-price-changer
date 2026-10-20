import type { TCostSource } from '../../modules/products/cost-history.domain';

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CostHistoryDocument = CostHistory & Document;

/**
 * Запись истории себестоимости товара: с какого дня действует закуп (TASK-116).
 *
 * Правила — `cost-history.domain.ts`. Здесь — почему форма такая:
 *  - `productId` — id товара `Product` СТРОКОЙ, без ref (в репозитории связей
 *    mongoose нет вовсе): себестоимость принадлежит физической модели, а не
 *    карточке ЯМ — с Ozon и WB у того же товара будут другие артикулы;
 *  - `validFrom` — московский день `ГГГГ-ММ-ДД` строкой; `null` — стартовая
 *    запись «с начала времён» (решение `cost_history_baseline_forever`);
 *  - закуп хранится ДО скидки бренда, как в `Product` и `PurchasePrice`: смена
 *    процента действует сразу и на прошлое, а история — только о цене поставщика.
 */
@Schema({ timestamps: true })
export class CostHistory {
  @Prop({ type: String, required: true })
  telegramUserId: string;

  @Prop({ type: String, required: true })
  productId: string;

  @Prop({ type: String, default: null })
  validFrom: string | null;

  /** Цена поставщика в валюте `currency` — как в прайсе, без скидки. */
  @Prop({ type: Number, required: true })
  price: number;

  @Prop({ type: String })
  currency?: string;

  @Prop({ type: Number })
  rate?: number;

  @Prop({ type: Number })
  extraCosts?: number;

  @Prop({ type: String, required: true })
  source: TCostSource;

  /**
   * Кто правил руками — telegramUserId продавца из CRM (TASK-118). У прайса и
   * стартовой нет: их пишет загрузка, а не человек.
   */
  @Prop({ type: String })
  author?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const CostHistorySchema = SchemaFactory.createForClass(CostHistory);

// Одна запись на товар и день, одна стартовая (`validFrom: null`) на товар:
// вторая загрузка за день переписывает запись, а не копит соседнюю.
CostHistorySchema.index({ productId: 1, validFrom: 1 }, { unique: true });

// Истории товаров продавца — одним `$in` при сборке отчёта.
CostHistorySchema.index({ telegramUserId: 1, productId: 1 });
