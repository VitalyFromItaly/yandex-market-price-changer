import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type BotDocument = Bot & Document;

// Interface for backward compatibility
export interface IBotSchema {
  _id?: string;
  name: string;
  token: string;
  type: string;
  description?: any;
  status?: string;
  created_at: Date;
  timezone?: string;
}

@Schema({ timestamps: true })
export class Bot {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true })
  token: string;

  @Prop({ required: true })
  type: string;

  @Prop({ type: Object })
  description?: any;

  @Prop()
  status?: string;

  @Prop({ default: Date.now })
  created_at: Date;

  @Prop()
  timezone?: string;
}

export const BotSchema = SchemaFactory.createForClass(Bot);
