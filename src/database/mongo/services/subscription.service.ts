import { SubscriptionModel, ISubscriptionSchema } from '../models/subscription.model.mongo';
import { TSubscriptionPlan } from '../models/models.domain';

export class SubscriptionService {

  /**
   * Получить подписку пользователя
   */
  static findByUserAndChat({ user_id, chat_id }): Promise<ISubscriptionSchema | null> {
    return SubscriptionModel.findOne({ user_id, chat_id });
  }

  /**
   * Создать новую подписку
   */
  static async createSubscription(
    payload: {
      user_id: number,
      chat_id: number,
      plan?: TSubscriptionPlan,
      paymentAmount?: number
}
  ): Promise<ISubscriptionSchema> {
    const { user_id, chat_id, plan = 'week', paymentAmount } = payload;
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
      default: 'week'
    }

    const expires_at = new Date(now.getTime() + extensionDays * 24 * 60 * 60 * 1000);

    const subscriptionData: Partial<ISubscriptionSchema> = {
      user_id,
      chat_id,
      status: 'active',
      plan,
      expires_at,
      last_payment_amount: paymentAmount,
      last_payment_date: paymentAmount ? now : undefined,
      payment_currency: 'RUB'
    };

    const subscription = new SubscriptionModel(subscriptionData);
    return await subscription.save();
  }

  /**
   * Продлить существующую подписку
   */
  static async extendSubscription(
    user_id: number,
    chat_id: number,
    plan: TSubscriptionPlan,
    paymentAmount?: number
  ): Promise<ISubscriptionSchema | null> {
    const subscription = await SubscriptionModel.findOne({
      user_id,
      chat_id,
    });

    if (!subscription) {
      return null;
    }

    await subscription.extend(plan, paymentAmount);
    return subscription;
  }

  /**
   * Проверить активность подписки
   */
  static async isSubscriptionActive(user_id: number, chat_id: number): Promise<boolean> {
    const subscription = await SubscriptionModel.findOne({
      user_id,
      chat_id,
    });

    if (!subscription) {
      return false;
    }

    return subscription.isActive();
  }

  /**
   * Отменить подписку
   */
  static async cancelSubscription(user_id: number, chat_id: number): Promise<ISubscriptionSchema | null> {
    const subscription = await SubscriptionModel.findOne({
      user_id,
      chat_id,
    });

    if (!subscription) {
      return null;
    }

    subscription.status = 'cancelled';
    // @ts-ignore
    return await subscription.save();
  }

  /**
   * Получить все активные подписки
   */
  static async getActiveSubscriptions(): Promise<ISubscriptionSchema[]> {
    return await SubscriptionModel.findActiveSubscriptions();
  }

  /**
   * Получить просроченные подписки
   */
  static async getExpiredSubscriptions(): Promise<ISubscriptionSchema[]> {
    return await SubscriptionModel.findExpiredSubscriptions();
  }

  /**
   * Обновить статус просроченных подписок
   */
  static async updateExpiredSubscriptions(): Promise<void> {
    const expiredSubscriptions = await SubscriptionModel.findExpiredSubscriptions();

    for (const subscription of expiredSubscriptions) {
      subscription.status = 'expired';

      // @ts-ignore
      await subscription.save();
    }
  }

  /**
   * Получить статистику подписок
   */
  static async getSubscriptionStats(): Promise<{
    total: number;
    active: number;
    expired: number;
    cancelled: number;
    inactive: number;
  }> {
    const [total, active, expired, cancelled, inactive] = await Promise.all([
      SubscriptionModel.countDocuments(),
      SubscriptionModel.countDocuments({ status: 'active', expires_at: { $gt: new Date() } }),
      SubscriptionModel.countDocuments({ status: 'expired' }),
      SubscriptionModel.countDocuments({ status: 'cancelled' }),
      SubscriptionModel.countDocuments({ status: 'inactive' })
    ]);

    return { total, active, expired, cancelled, inactive };
  }

  /**
   * Получить подписки по плану
   */
  static async getSubscriptionsByPlan(plan: TSubscriptionPlan): Promise<ISubscriptionSchema[]> {
    return await SubscriptionModel.find({ plan, status: 'active' });
  }
}
