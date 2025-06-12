import mongoose from 'mongoose';
import { EBotType } from '../../../telegram/domain.telegram';
import { TBotStatus } from './models.domain';

export interface IBotSchema {
  name?: string;
  token: string;
  type?: EBotType;
  description?: any;
  subscription?: any;
  status?: TBotStatus;
  created_at: Date;
  timezone?: string;
}

const botsSchema = new mongoose.Schema<IBotSchema>({
  name: { type: String },
  token: { type: String, require: true },
  type: { type: String },
  description: { type: mongoose.Schema.Types.Mixed },
  subscription:  { type: mongoose.Schema.Types.Mixed },
  status: { type: String }, // описать статусную схему
  created_at: { type: Date, default: Date.now }, // должно быть в ютс формате
  timezone: { type: String }, // дата в utc
});
export const BotsModel = mongoose.model('Bots', botsSchema);
