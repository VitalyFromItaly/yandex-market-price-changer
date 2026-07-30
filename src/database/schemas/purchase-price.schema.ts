import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PurchasePriceDocument = PurchasePrice & Document;

/**
 * Закупочная цена одной позиции: один документ на (продавец × артикул).
 *
 * Откуда берётся. Из прайса поставщика, который продавец УЖЕ загружает для
 * обновления остатков. Парсер читал колонку «Цена» и раньше (`IPriceRow.price`),
 * но `StockSyncService` брал из строки только количество — цена записывалась и
 * никем не читалась.
 *
 * Почему отдельная коллекция, а не поле в YandexMarket: позиций четыре тысячи на
 * продавца, они переписываются целым файлом и не имеют отношения к кредам. Тот же
 * довод, что у ReportSchedule.
 *
 * КЛЮЧ — артикул КАТАЛОГА Яндекса (`offerId`), уже разрешённый `sku-resolver`, а
 * не наименование из прайса. Это принципиально: в позициях заказа приходит именно
 * `offerId`, и только по нему закуп сходится с продажей. Наименование из прайса
 * («ORIENT RA-AA0001B19») в каталоге может быть заведено иначе, и join по нему
 * молча не нашёл бы ничего.
 *
 * Скоуп — `telegramUserId` один, без `botId`: магазин тоже скоуплен по нему
 * одному (unique sparse в YandexMarket), а закуп относится к магазину, не к боту.
 */
@Schema({ timestamps: true })
export class PurchasePrice {
  @Prop({ type: String, required: true })
  telegramUserId: string;

  /** Артикул каталога Яндекса — то же значение, что `offerId` в позиции заказа. */
  @Prop({ type: String, required: true })
  sku: string;

  /** Цена закупки в рублях. */
  @Prop({ type: Number, required: true })
  price: number;

  /** Наименование из прайса — чтобы в отчёте было видно, о каком товаре речь. */
  @Prop({ type: String })
  name?: string;

  /** Категория из прайса. Нужна только для отчётов. */
  @Prop({ type: String })
  category?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const PurchasePriceSchema = SchemaFactory.createForClass(PurchasePrice);

// Одна цена на артикул: дубли отсекает база, а не проверка в коде. Повторная
// загрузка прайса обновляет документ, а не добавляет второй.
PurchasePriceSchema.index({ telegramUserId: 1, sku: 1 }, { unique: true });
