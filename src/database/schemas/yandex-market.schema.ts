import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

import {
  DEFAULT_COMMISSION_PERCENT,
  DEFAULT_DISCOUNT_PERCENT,
  DEFAULT_TAX_PERCENT,
  DEFAULT_VOSTOK_DISCOUNT_PERCENT,
} from '../../modules/yandex/reports/profit';

export type YandexMarketDocument = YandexMarket & Document;

@Schema({ timestamps: true })
export class YandexMarket {
  @Prop({ required: true })
  campaign_id: string;

  @Prop({ required: true })
  business_id: string;

  @Prop({ required: true })
  token: string;

  @Prop({ default: 1.2 })
  priceCoefficient: number;

  /**
   * Комиссия Яндекс.Маркета, % — вычитается из суммы продажи при расчёте прибыли.
   *
   * Дефолт импортируется, а не написан литералом: у соседнего
   * `priceCoefficient` он разъехался по четырём файлам именно так.
   */
  @Prop({ type: Number, default: DEFAULT_COMMISSION_PERCENT })
  commissionPercent: number;

  /** Налог с продаж, % — считается от суммы продажи (см. profit.ts). */
  @Prop({ type: Number, default: DEFAULT_TAX_PERCENT })
  taxPercent: number;

  /**
   * Скидка от цены прайса, % — из неё получается закуп.
   *
   * В прайсе стоит цена поставщика, а не закупочная: закуп = цена × (1 − скидка).
   * По «Востоку» скидка своя, поэтому их две.
   */
  @Prop({ type: Number, default: DEFAULT_DISCOUNT_PERCENT })
  discountPercent: number;

  /** Скидка от цены прайса на «Восток», %. */
  @Prop({ type: Number, default: DEFAULT_VOSTOK_DISCOUNT_PERCENT })
  vostokDiscountPercent: number;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;

  @Prop()
  name?: string;

  @Prop()
  telegramUserId?: string;

  @Prop()
  telegramChatId?: string;
}

export const YandexMarketSchema = SchemaFactory.createForClass(YandexMarket);

// Индексы для оптимизации поиска
YandexMarketSchema.index({ campaign_id: 1 });
YandexMarketSchema.index({ telegramChatId: 1 });

/**
 * Один магазин на пользователя — unique, и именно по telegramUserId ОДНОМУ.
 *
 * В задаче TASK-006 записан составной unique по паре (telegramUserId,
 * telegramChatId), и на момент её формулировки это было верно: telegramChatId
 * тогда хранил id БОТА, то есть пара означала «пользователь × бот». Сейчас
 * туда пишется настоящий ctx.chat.id, который арендатора не различает, и
 * составной индекс перестал бы отсекать дубли вообще.
 *
 * Решает не форма индекса, а то, КАК код читает данные: все обращения идут
 * через findByTelegramUser — по одному полю. Два документа на пользователя
 * означали бы, что findOne возвращает произвольный из них, и продавец
 * получал бы отчёты то по одному магазину, то по другому. Такие дубли в базе
 * уже находились (два документа на один telegramUserId).
 *
 * sparse — потому что поле объявлено необязательным.
 */
YandexMarketSchema.index({ telegramUserId: 1 }, { unique: true, sparse: true });

// Методы экземпляра
YandexMarketSchema.methods.updatePriceCoefficient = async function (
  coefficient: number,
): Promise<YandexMarketDocument> {
  this.priceCoefficient = coefficient;
  this.updatedAt = new Date();
  return await this.save();
};

YandexMarketSchema.methods.isConfigured = function (): boolean {
  return !!(this.campaign_id && this.business_id && this.token);
};
