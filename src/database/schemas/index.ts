export * from './bot.schema';
export * from './user.schema';
export * from './user-access.schema';
export * from './report-schedule.schema';
export * from './purchase-price.schema';
export * from './yandex-market.schema';

export interface IYandexMarketSchema {
  telegramUserId: number;
  telegramChatId: number;
  campaign_id?: string;
  business_id?: string;
  token?: string;
  priceCoefficient?: number;
  name?: string;
  created_at: Date;
  updated_at: Date;
}
