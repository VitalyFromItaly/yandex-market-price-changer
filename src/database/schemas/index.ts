export * from './bot.schema';
export * from './user.schema';
export * from './subscription.schema';
export * from './yandex-market.schema';

// Legacy interfaces for backward compatibility
export interface ISubscriptionSchema {
  user_id: number;
  chat_id: number;
  plan: 'day' | 'week' | 'month' | 'year';
  expires_at: Date;
  status: 'active' | 'expired' | 'cancelled' | 'inactive';
  last_payment_amount?: number;
  created_at: Date;
  updated_at: Date;
}

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