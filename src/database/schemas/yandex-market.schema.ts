import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

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
YandexMarketSchema.index({ telegramUserId: 1 });
YandexMarketSchema.index({ telegramChatId: 1 });

// Методы экземпляра
YandexMarketSchema.methods.updatePriceCoefficient = async function(coefficient: number): Promise<YandexMarketDocument> {
  this.priceCoefficient = coefficient;
  this.updatedAt = new Date();
  return await this.save();
};

YandexMarketSchema.methods.isConfigured = function(): boolean {
  return !!(this.campaign_id && this.business_id && this.token);
}; 