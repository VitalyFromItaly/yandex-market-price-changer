import type { TLinkSource } from '../../modules/products/product.domain';

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type ProductDocument = Product & Document;

/** Артикулы (идентификаторы карточек) товара на площадках. */
export interface IProductMarketplaceSkus {
  ym?: string;
  ozon?: string;
  wb?: string;
}

/** Откуда привязка товара к карточке площадки (TASK-117). */
export interface IProductMarketplaceLink {
  source: TLinkSource;
  linkedAt: Date;
}

/** Привязки по площадкам; ключи — те же, что в `marketplaceSkus`. */
export interface IProductMarketplaceLinks {
  ym?: IProductMarketplaceLink;
  ozon?: IProductMarketplaceLink;
  wb?: IProductMarketplaceLink;
}

/** Цены продажи по площадкам, в рублях. */
export interface IProductSalePrices {
  ym?: number;
  ozon?: number;
  wb?: number;
}

/** Закуп товара: цена поставщика ДО скидки бренда (см. `productCost`). */
export interface IProductPurchaseDoc {
  price: number;
  currency?: string;
  rate?: number;
  extraCosts?: number;
}

/**
 * Товар продавца — master SKU: одна физическая модель, у которой может быть
 * по карточке на ЯМ, Ozon и WB (ТЗ п.6).
 *
 * НЕ замена `PurchasePrice`. Тот остаётся, прибыль бота читает его; Product
 * надстраивается рядом, и загрузка прайса пишет в оба (`StockSyncService`).
 *
 * Источники и кто что пишет:
 *  - прайс (наша Mongo) — закуп, название, категория;
 *  - каталог ЯМ (offer-mappings, только чтение) — бренд карточки, артикул
 *    производителя, штрихкоды, цена продажи на ЯМ.
 *
 * БРЕНД (ключ скидки) в базу НЕ пишется: он выводится `brandOf({name,
 * category})` при чтении. Сохранённая копия разошлась бы с реестром
 * `brands.ts` на первой же его правке. `vendor` — другое: это строка из
 * карточки Маркета, как её ввёл продавец.
 *
 * Закуп хранится ДО скидки бренда, как в `PurchasePrice`: смена процента
 * действует сразу, без перезаливки прайса (довод `applyDiscounts`).
 */
@Schema({ timestamps: true })
export class Product {
  @Prop({ type: String, required: true })
  telegramUserId: string;

  /** Внутренний SKU продавца. При заполнении — артикул ЯМ (offerId). */
  @Prop({ type: String, required: true })
  internalSku: string;

  @Prop({ type: String })
  name?: string;

  @Prop({ type: String })
  category?: string;

  /** Бренд в карточке Маркета, как его ввёл продавец. */
  @Prop({ type: String })
  vendor?: string;

  /** Модель. При заполнении не пишется: из источников её не вывести надёжно. */
  @Prop({ type: String })
  model?: string;

  /** Артикул производителя. */
  @Prop({ type: String })
  vendorCode?: string;

  @Prop({ type: [String], default: undefined })
  barcodes?: string[];

  @Prop({ type: MongooseSchema.Types.Mixed })
  marketplaceSkus?: IProductMarketplaceSkus;

  /**
   * Откуда взялась каждая привязка из `marketplaceSkus` (`matchCards`). Нужна
   * админу, чтобы отличить ручную привязку от автоматической. Защищает ручную
   * привязку не она: автомат уже привязанную карточку не трогает вовсе.
   */
  @Prop({ type: MongooseSchema.Types.Mixed })
  marketplaceLinks?: IProductMarketplaceLinks;

  @Prop({ type: MongooseSchema.Types.Mixed })
  purchase?: IProductPurchaseDoc;

  /** Когда закуп последний раз пришёл из прайса. */
  @Prop({ type: Date })
  purchaseUpdatedAt?: Date;

  /**
   * Свой склад — количество из последнего прайса, где была эта позиция
   * (TASK-142, решение `inventory_own_stock_from_price_list`). Не сумма FBS
   * площадок: это один физический склад, показанный каждой площадкой.
   */
  @Prop({ type: Number })
  stock?: number;

  /** Когда `stock` последний раз пришёл из прайса — прайс может покрывать один бренд. */
  @Prop({ type: Date })
  stockUpdatedAt?: Date;

  @Prop({ type: MongooseSchema.Types.Mixed })
  salePrices?: IProductSalePrices;

  /** Когда карточка последний раз сверялась с каталогом ЯМ. */
  @Prop({ type: Date })
  catalogSyncedAt?: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const ProductSchema = SchemaFactory.createForClass(Product);

// Один товар на внутренний SKU продавца: дубль отсекает база.
ProductSchema.index({ telegramUserId: 1, internalSku: 1 }, { unique: true });

// Артикул ЯМ ищется индексом и принадлежит максимум одному товару. Partial:
// у товара, которого нет на ЯМ, поля нет, и «отсутствие» не должно быть общим
// значением для всех таких товаров.
//
// Условие — `$exists: true`, а НЕ `$type: 'string'`: partial-индекс берётся,
// только если планировщик выводит его условие из запроса. Равенство и `$in`
// выводят `$exists`, но не `$type` — с `$type` индекс не попадал даже в
// кандидаты, и поиск по артикулу сканировал все ~19 тыс. товаров продавца
// (проверено explain на живой Mongo, 15-10-2026).
//
// Ozon и WB — то же правило (TASK-117): карточка площадки привязана максимум к
// одному товару, и держит это база, а не порядок записей.
for (const marketplace of ['ym', 'ozon', 'wb'] as const) {
  const path = `marketplaceSkus.${marketplace}`;
  ProductSchema.index(
    { telegramUserId: 1, [path]: 1 },
    { unique: true, partialFilterExpression: { [path]: { $exists: true } } },
  );
}

// Сопоставление по штрихкоду. Проход по каталогу (`matchCards`) читает товары
// продавца целиком и строит индексы в памяти, этот индекс — для поиска одной
// карточки (Ozon/WB). Индекса по vendorCode нет: сравнение без учёта регистра
// он не обслужил бы, а целый проход в нём не нуждается.
ProductSchema.index({ telegramUserId: 1, barcodes: 1 });
