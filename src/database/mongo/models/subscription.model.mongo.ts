import mongoose, { Document, Model } from 'mongoose';
import { TSubscriptionPlan, TSubscriptionStatus } from './models.domain';

export interface ISubscriptionSchema {
  user_id: number; // Telegram user ID
  chat_id: number; // Telegram chat ID
  status: TSubscriptionStatus; // Статус подписки
  plan: TSubscriptionPlan; // Тарифный план
  expires_at: Date; // Когда заканчивается подписка
  last_payment_amount?: number; // Сумма последнего платежа
  last_payment_date?: Date; // Дата последнего платежа
  payment_currency?: string; // Валюта платежа (RUB, USD, EUR и т.д.)
  created_at: Date; // Дата создания подписки
  updated_at: Date; // Дата последнего обновления

  isActive(): boolean; // Метод для проверки активности подписки
  extend(plan: TSubscriptionPlan, paymentAmount?: number): Promise<ISubscriptionSchema>; // Метод для продления подписки
}

const SubscriptionSchema = new mongoose.Schema<ISubscriptionSchema>({
  user_id: { type: Number, required: true },
  chat_id: { type: Number, required: true },
  status: {
    type: String,
    enum: ['active', 'inactive', 'expired', 'cancelled'],
    default: 'inactive',
    required: true
  },
  plan: {
    type: String,
    enum: ['day', 'week', 'month', 'year'],
    required: true
  },
  expires_at: { type: Date, required: true },
  last_payment_amount: { type: Number },
  last_payment_date: { type: Date },
  payment_currency: { type: String, default: 'RUB' },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

// Индексы для оптимизации поиска
SubscriptionSchema.index({ user_id: 1 });
SubscriptionSchema.index({ chat_id: 1 });
SubscriptionSchema.index({ user_id: 1, chat_id: 1 }, { unique: true });
SubscriptionSchema.index({ status: 1 });
SubscriptionSchema.index({ expires_at: 1 });

// Middleware для автоматического обновления updated_at
SubscriptionSchema.pre('save', function(next) {
  this.updated_at = new Date();
  next();
});

// Метод для проверки активности подписки
SubscriptionSchema.methods.isActive = function() {
  return this.status === 'active' && this.expires_at > new Date();
};

// Метод для продления подписки
SubscriptionSchema.methods.extend = function(plan: TSubscriptionPlan, paymentAmount?: number) {
  const now = new Date();
  let extensionDays = 0;

  switch (plan) {
    case 'day':
      extensionDays = 1;
      break;
    case 'week':
      extensionDays = 7;
      break;
    case 'month':
      extensionDays = 30;
      break;
    case 'year':
      extensionDays = 365;
      break;
  }

  // Если подписка еще активна, продлеваем от даты окончания
  // Если нет - продлеваем от текущей даты
  const baseDate = this.isActive() ? this.expires_at : now;
  this.expires_at = new Date(baseDate.getTime() + extensionDays * 24 * 60 * 60 * 1000);

  this.status = 'active';
  this.plan = plan;

  if (paymentAmount) {
    this.last_payment_amount = paymentAmount;
    this.last_payment_date = now;
  }

  return this.save();
};

// Интерфейс для статических методов
interface ISubscriptionModel extends Model<ISubscriptionSchema> {
  findActiveSubscriptions(): Promise<ISubscriptionSchema[]>;
  findExpiredSubscriptions(): Promise<ISubscriptionSchema[]>;
}

// Статический метод для поиска активных подписок
SubscriptionSchema.statics.findActiveSubscriptions = function() {
  return this.find({
    status: 'active',
    expires_at: { $gt: new Date() }
  });
};

// Статический метод для поиска просроченных подписок
SubscriptionSchema.statics.findExpiredSubscriptions = function() {
  return this.find({
    status: 'active',
    expires_at: { $lte: new Date() }
  });
};

export const SubscriptionModel = mongoose.model<ISubscriptionSchema, ISubscriptionModel>('Subscription', SubscriptionSchema);
