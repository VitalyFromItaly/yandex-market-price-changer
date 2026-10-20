import type { TMarketplace } from '../../shared/marketplace';

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, SchemaTypes } from 'mongoose';

export type MarketplaceConnectionDocument = MarketplaceConnection & Document;

/**
 * Площадки, подключение которых хранится в этой коллекции. ЯМ здесь нет
 * НАМЕРЕННО (решение `marketplace_connection_ym_virtual`): его креды живут в
 * `YandexMarket`, их читают бот и все отчёты, а копия токена в двух местах
 * разошлась бы при первой смене. Подключение ЯМ собирается из `YandexMarket`
 * при чтении (`MarketplaceConnectionsService`).
 */
export const STORED_CONNECTION_MARKETPLACES = [
  'ozon',
  'wb',
] as const satisfies readonly TMarketplace[];
export type TStoredConnectionMarketplace = (typeof STORED_CONNECTION_MARKETPLACES)[number];

/**
 * Итог последней проверки кредов площадкой. Три неудачи — разные ответы (урок
 * TASK-077): отказ ключа, недоступность площадки, пустой список кабинетов.
 * `unverified` — записано, но ещё не проверялось.
 */
export const CONNECTION_STATUSES = [
  'unverified',
  'ok',
  'rejected',
  'unavailable',
  'empty',
] as const;
export type TConnectionStatus = (typeof CONNECTION_STATUSES)[number];

/** Кабинет или магазин площадки — то, что продавец выбирает в CRM. */
export interface IConnectionAccount {
  id: string;
  name: string;
}

/**
 * Подключение продавца к площадке (TASK-127). Одно на `(telegramUserId, marketplace)`.
 *
 *  - `credentials` — форма своя у каждой площадки (Ozon: Client-Id + Api-Key,
 *    WB: токен), поэтому Mixed. `select: false`: ни один обычный find не
 *    вытащит ключи, читать их может только `credentialsOf` — и наружу
 *    (ответы CRM, журнал) они так не попадут по забывчивости;
 *  - `accounts` — кабинеты/магазины, которые открыл ключ: по ним CRM строит
 *    список, как `YandexMarket.stores` у ЯМ.
 */
@Schema({ timestamps: true })
export class MarketplaceConnection {
  @Prop({ type: String, required: true })
  telegramUserId: string;

  @Prop({ type: String, required: true, enum: STORED_CONNECTION_MARKETPLACES })
  marketplace: TStoredConnectionMarketplace;

  @Prop({ type: SchemaTypes.Mixed, select: false })
  credentials?: Record<string, string>;

  @Prop({ type: String, required: true, enum: CONNECTION_STATUSES, default: 'unverified' })
  status: TConnectionStatus;

  @Prop({ type: Date })
  checkedAt?: Date;

  /** Что ответила площадка при неудачной проверке — текст для продавца, без ключа. */
  @Prop({ type: String })
  checkError?: string;

  @Prop({ type: [{ id: String, name: String, _id: false }], default: undefined })
  accounts?: IConnectionAccount[];

  createdAt?: Date;
  updatedAt?: Date;
}

export const MarketplaceConnectionSchema = SchemaFactory.createForClass(MarketplaceConnection);

// Одно подключение площадки на продавца: повторное подключение переписывает
// документ, а не заводит второй с другим ключом.
MarketplaceConnectionSchema.index({ telegramUserId: 1, marketplace: 1 }, { unique: true });
