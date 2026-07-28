import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SubscriptionDocument = Subscription & Document;

export type TSubscriptionPlan = 'day' | 'week' | 'month' | 'year';
export type TSubscriptionStatus = 'active' | 'inactive' | 'expired' | 'cancelled';

@Schema({ timestamps: true })
export class Subscription {
  @Prop({ required: true })
  user_id: number;

  @Prop({ required: true })
  chat_id: number;

  @Prop({ 
    type: String, 
    enum: ['active', 'inactive', 'expired', 'cancelled'],
    default: 'inactive',
    required: true 
  })
  status: TSubscriptionStatus;

  @Prop({ 
    type: String, 
    enum: ['day', 'week', 'month', 'year'],
    required: true 
  })
  plan: TSubscriptionPlan;

  @Prop({ required: true })
  expires_at: Date;

  @Prop()
  last_payment_amount?: number;

  @Prop()
  last_payment_date?: Date;

  @Prop({ default: 'RUB' })
  payment_currency?: string;

  @Prop({ default: Date.now })
  created_at: Date;

  @Prop({ default: Date.now })
  updated_at: Date;
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);

// Индексы для оптимизации поиска
SubscriptionSchema.index({ user_id: 1 });
SubscriptionSchema.index({ chat_id: 1 });
SubscriptionSchema.index({ user_id: 1, chat_id: 1 });

// Методы экземпляра
SubscriptionSchema.methods.isActive = function(): boolean {
  return this.status === 'active' && new Date() < this.expires_at;
};

SubscriptionSchema.methods.extend = async function(plan: TSubscriptionPlan, paymentAmount?: number): Promise<SubscriptionDocument> {
  this.plan = plan;
  this.status = 'active';
  this.last_payment_amount = paymentAmount;
  this.last_payment_date = new Date();
  
  // Рассчитываем новую дату истечения
  const now = new Date();
  switch (plan) {
    case 'day':
      this.expires_at = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      break;
    case 'week':
      this.expires_at = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      break;
    case 'month':
      this.expires_at = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      break;
    case 'year':
      this.expires_at = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      break;
  }
  
  this.updated_at = new Date();
  return await this.save();
}; 