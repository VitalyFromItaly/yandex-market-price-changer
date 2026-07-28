import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Subscription, SubscriptionDocument } from '../schemas/subscription.schema';

export interface CreateSubscriptionDto {
  user_id: number;
  chat_id: number;
  plan?: 'day' | 'week' | 'month' | 'year';
  last_payment_amount?: number;
}

export interface UpdateSubscriptionDto {
  plan?: 'day' | 'week' | 'month' | 'year';
  last_payment_amount?: number;
  expires_at?: Date;
  status?: 'active' | 'expired' | 'cancelled' | 'inactive';
}

@Injectable()
export class SubscriptionService {
  constructor(
    @InjectModel(Subscription.name) 
    private subscriptionModel: Model<SubscriptionDocument>
  ) {}

  /**
   * Получить подписку пользователя
   */
  async findByUserAndChat(user_id: number, chat_id: number): Promise<SubscriptionDocument | null> {
    try {
      return await this.subscriptionModel.findOne({ user_id, chat_id }).exec();
    } catch (error) {
      console.error('Error finding subscription:', error);
      return null;
    }
  }

  /**
   * Создать новую подписку
   */
  async createSubscription(payload: CreateSubscriptionDto): Promise<SubscriptionDocument> {
    const { user_id, chat_id, plan = 'week', last_payment_amount } = payload;
    const now = new Date();
    
    // Вычисляем дату окончания подписки
    const expiresAt = new Date(now);
    switch (plan) {
      case 'week':
        expiresAt.setDate(now.getDate() + 7);
        break;
      case 'month':
        expiresAt.setMonth(now.getMonth() + 1);
        break;
      case 'year':
        expiresAt.setFullYear(now.getFullYear() + 1);
        break;
    }

    const subscription = new this.subscriptionModel({
      user_id,
      chat_id,
      plan,
      last_payment_amount,
      expires_at: expiresAt,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });

    return await subscription.save();
  }

  /**
   * Продлить подписку
   */
  async extendSubscription(
    user_id: number,
    chat_id: number,
    plan: 'day' | 'week' | 'month' | 'year',
    last_payment_amount?: number
  ): Promise<SubscriptionDocument | null> {
    try {
      const subscription = await this.findByUserAndChat(user_id, chat_id);
      if (!subscription) {
        return null;
      }

      const now = new Date();
      const currentExpiry = subscription.expires_at || now;
      const newExpiry = new Date(Math.max(currentExpiry.getTime(), now.getTime()));

      switch (plan) {
        case 'day':
          newExpiry.setDate(newExpiry.getDate() + 1);
          break;
        case 'week':
          newExpiry.setDate(newExpiry.getDate() + 7);
          break;
        case 'month':
          newExpiry.setMonth(newExpiry.getMonth() + 1);
          break;
        case 'year':
          newExpiry.setFullYear(newExpiry.getFullYear() + 1);
          break;
      }

      subscription.expires_at = newExpiry;
      subscription.plan = plan;
      subscription.status = 'active';
      subscription.updated_at = now;
      if (last_payment_amount) {
        subscription.last_payment_amount = last_payment_amount;
      }

      return await subscription.save();
    } catch (error) {
      console.error('Error extending subscription:', error);
      return null;
    }
  }

  /**
   * Проверить активность подписки
   */
  async isSubscriptionActive(user_id: number, chat_id: number): Promise<boolean> {
    try {
      const subscription = await this.findByUserAndChat(user_id, chat_id);
      if (!subscription) {
        return false;
      }

      // Проверяем активность подписки
      return subscription.status === 'active' && new Date() < subscription.expires_at;
    } catch (error) {
      console.error('Error checking subscription status:', error);
      return false;
    }
  }

  /**
   * Отменить подписку
   */
  async cancelSubscription(user_id: number, chat_id: number): Promise<SubscriptionDocument | null> {
    try {
      return await this.subscriptionModel.findOneAndUpdate(
        { user_id, chat_id },
        {
          isActive: false,
          status: 'cancelled',
          updatedAt: new Date(),
        },
        { new: true }
      ).exec();
    } catch (error) {
      console.error('Error cancelling subscription:', error);
      return null;
    }
  }

  /**
   * Получить активные подписки
   */
  async getActiveSubscriptions(): Promise<SubscriptionDocument[]> {
    return await this.subscriptionModel.find({
      isActive: true,
      status: 'active',
      expires_at: { $gt: new Date() }
    }).exec();
  }

  /**
   * Получить истекшие подписки
   */
  async getExpiredSubscriptions(): Promise<SubscriptionDocument[]> {
    return await this.subscriptionModel.find({
      $or: [
        { expires_at: { $lte: new Date() } },
        { status: 'expired' }
      ]
    }).exec();
  }

  /**
   * Обновить истекшие подписки
   */
  async updateExpiredSubscriptions(): Promise<void> {
    try {
      await this.subscriptionModel.updateMany(
        {
          expires_at: { $lte: new Date() },
          status: { $ne: 'expired' }
        },
        {
          isActive: false,
          status: 'expired',
          updatedAt: new Date(),
        }
      ).exec();
    } catch (error) {
      console.error('Error updating expired subscriptions:', error);
    }
  }

  /**
   * Получить статистику подписок
   */
  async getSubscriptionStats(): Promise<{
    total: number;
    active: number;
    expired: number;
    cancelled: number;
    inactive: number;
  }> {
    const [total, active, expired, cancelled, inactive] = await Promise.all([
      this.subscriptionModel.countDocuments().exec(),
      this.subscriptionModel.countDocuments({ status: 'active' }).exec(),
      this.subscriptionModel.countDocuments({ status: 'expired' }).exec(),
      this.subscriptionModel.countDocuments({ status: 'cancelled' }).exec(),
      this.subscriptionModel.countDocuments({ status: 'inactive' }).exec(),
    ]);

    return { total, active, expired, cancelled, inactive };
  }

  /**
   * Получить подписки по плану
   */
  async getSubscriptionsByPlan(plan: 'week' | 'month' | 'year'): Promise<SubscriptionDocument[]> {
    return await this.subscriptionModel.find({ plan }).exec();
  }
} 