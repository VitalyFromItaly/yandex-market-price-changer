import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserAccessDocument = UserAccess & Document;

/**
 * new       — пользователь есть, кредов ещё нет. Единственный статус, в котором
 *             разрешено вводить креды: это и есть регистрация.
 * pending   — креды собраны, карточка ушла администраторам, ждём решения.
 * approved  — доступ выдан.
 * rejected  — отказ. Сутки нельзя даже вводить креды, потом статус лениво
 *             возвращается в new (см. UserAccessService.expireRejection).
 */
export type TAccessStatus = 'new' | 'pending' | 'approved' | 'rejected';

export const ACCESS_STATUSES: TAccessStatus[] = [
  'new',
  'pending',
  'approved',
  'rejected',
];

/** Куда именно ушла карточка заявки — чтобы отредактировать её после решения. */
export interface IAdminCard {
  adminId: string;
  chatId: number;
  messageId: number;
}

/**
 * Запись доступа: пара (пользователь × бот).
 *
 * Заменила Subscription, где ключом были (user_id, chat_id) и chat_id на самом
 * деле хранил id БОТА — из-за чего поле невозможно было использовать по
 * назначению. Здесь эти две сущности разведены явно: botId — арендатор,
 * telegramChatId — реальный чат, единственное, что можно передавать в
 * sendMessage.
 *
 * Черновик кредов живёт здесь, а не в YandexMarket, потому что три поля
 * YandexMarket объявлены required, а пользователь вводит их по одному. Документ
 * YandexMarket создаётся один раз и сразу целиком.
 */
@Schema({ timestamps: true })
export class UserAccess {
  @Prop({ type: String, required: true })
  telegramUserId: string;

  /** ctx.botInfo.id — арендатор. НЕ чат. */
  @Prop({ type: String, required: true })
  botId: string;

  /** ctx.chat.id — куда писать пользователю. */
  @Prop({ type: String, required: true })
  telegramChatId: string;

  @Prop({
    type: String,
    enum: ACCESS_STATUSES,
    default: 'new',
    required: true,
  })
  status: TAccessStatus;

  /** Ник без ведущей @ — по нему администратор пишет пользователю напрямую. */
  @Prop({ type: String })
  username?: string;

  @Prop({ type: String })
  firstName?: string;

  @Prop({ type: String })
  lastName?: string;

  /** Собираемые по одному креды. Стирается при подаче заявки. */
  @Prop({ type: Object })
  draft?: {
    token?: string;
    campaign_id?: string;
    business_id?: string;
  };

  /**
   * Какой отчёт ждёт ввода времени рассылки. Состояние диалога живёт здесь же,
   * рядом с пользователем: заводить ради одного поля отдельное хранилище (и уж
   * тем более Redis с TTL) — несоразмерно.
   */
  @Prop({ type: String })
  pendingScheduleReport?: string;

  @Prop({ type: Date })
  appliedAt?: Date;

  @Prop({ type: Date })
  approvedAt?: Date;

  @Prop({ type: Date })
  rejectedAt?: Date;

  /** Telegram id администратора, принявшего решение. */
  @Prop({ type: String })
  decidedBy?: string;

  @Prop({ type: String })
  decidedByUsername?: string;

  /**
   * message_id карточек у каждого администратора. Лежит в базе, а не в памяти
   * процесса: между подачей заявки и решением бот вполне может перезапуститься.
   */
  @Prop({
    type: [{ adminId: String, chatId: Number, messageId: Number, _id: false }],
    default: [],
  })
  adminCards: IAdminCard[];

  createdAt?: Date;
  updatedAt?: Date;
}

export const UserAccessSchema = SchemaFactory.createForClass(UserAccess);

// Тот самый составной unique, который был потерян у Subscription при миграции
// (TASK-006). На новой коллекции ставим сразу правильно: одна запись доступа на
// пару (пользователь × бот), дубли отсекает база, а не проверка в коде.
UserAccessSchema.index({ telegramUserId: 1, botId: 1 }, { unique: true });

// Под выборку протухших отказов.
UserAccessSchema.index({ status: 1, rejectedAt: 1 });
