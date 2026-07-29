import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true })
  username: string;

  // sparse на всех НЕОБЯЗАТЕЛЬНЫХ unique-полях. Без него Mongo считает
  // отсутствующее значение обычным null и одинаковым у всех документов:
  // второй пользователь без email ловил бы ошибку дубликата по ключу null.
  @Prop({ unique: true, sparse: true })
  telegramId?: string;

  @Prop({ unique: true, sparse: true })
  email?: string;

  @Prop({ unique: true, sparse: true })
  apiToken?: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Добавляем методы к схеме
UserSchema.methods.generateToken = function() {
  const crypto = require('crypto');
  this.apiToken = crypto.randomBytes(32).toString('hex');
  return this.apiToken;
};

UserSchema.statics.findByToken = async function(token: string) {
  if (!token) {
    return null;
  }
  return this.findOne({ apiToken: token });
}; 