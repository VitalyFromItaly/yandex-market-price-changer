import mongoose from 'mongoose';

// define interface for the Yandex Market schema

export interface IYandexMarketSchema extends mongoose.Document {
  campaign_id: string; // ID магазина кампании
  // campaign_ids?: string[]; // Массив ID кампаний (если нужно хранить несколько)
  business_id: string; // ID бизнеса
  token: string; // Токен доступа к API
  priceCoefficient: number; // Коэффициент изменения цены (например: 1.2 для +20%)
  createdAt: Date; // Дата создания записи
  updatedAt: Date; // Дата последнего обновления записи
  name?: string; // Имя кампании или бизнеса
  telegramUserId?: string; // ID пользователя Telegram
  telegramChatId?: string; // ID чата Telegram

  // Методы экземпляра
  updatePriceCoefficient(coefficient: number): Promise<IYandexMarketSchema>;
  isConfigured(): boolean;
}

const YandexMarketSchema = new mongoose.Schema<IYandexMarketSchema>({
  campaign_id: { type: String },
  business_id: { type: String },
  token: { type: String },
  priceCoefficient: { type: Number, default: 1.2 }, // По умолчанию коэффициент 1.2
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  name: { type: String },
  telegramUserId: { type: String }, // ID пользователя Telegram
  telegramChatId: { type: String }
});

// Методы экземпляра
YandexMarketSchema.methods.updatePriceCoefficient = async function(coefficient: number): Promise<IYandexMarketSchema> {
  this.priceCoefficient = coefficient;
  this.updatedAt = new Date();
  return await this.save();
};

YandexMarketSchema.methods.isConfigured = function(): boolean {
  return !!(this.campaign_id && this.business_id && this.token);
};

// Индексы для оптимизации поиска
YandexMarketSchema.index({ campaign_id: 1 });
YandexMarketSchema.index({ business_id: 1 });
YandexMarketSchema.index({ telegramUserId: 1 });
YandexMarketSchema.index({ telegramChatId: 1 });
YandexMarketSchema.index({ userId: 1 });

// Составной уникальный индекс для предотвращения дублирования записей пользователя
YandexMarketSchema.index({ telegramUserId: 1, telegramChatId: 1 }, { unique: true });

export const YandexMarketModel = mongoose.model('YandexMarket', YandexMarketSchema);
