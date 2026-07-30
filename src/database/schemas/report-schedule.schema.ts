import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ReportScheduleDocument = ReportSchedule & Document;

/**
 * Настройка ежедневной рассылки: один документ на (пользователь × бот × отчёт).
 *
 * Отдельная коллекция, а не поле в YandexMarket: настройки четыре, они меняются
 * независимо друг от друга, и «включить один отчёт» не должно трогать документ
 * с кредами продавца.
 *
 * Время хранится строкой «ЧЧ:ММ» и ВСЕГДА трактуется как Europe/Moscow —
 * хранить его в UTC нельзя: при смене правил часового пояса рассылка, заданная
 * пользователем на 9 утра, молча уехала бы на другой час.
 */
@Schema({ timestamps: true })
export class ReportSchedule {
  @Prop({ type: String, required: true })
  telegramUserId: string;

  @Prop({ type: String, required: true })
  botId: string;

  /** Ключ отчёта из report-status-map. */
  @Prop({ type: String, required: true })
  reportKey: string;

  /**
   * Выключено по умолчанию. Бот не должен начинать писать сам, пока его об
   * этом явно не попросили.
   */
  @Prop({ type: Boolean, default: false, required: true })
  enabled: boolean;

  /** «ЧЧ:ММ» по Москве. */
  @Prop({ type: String, default: '09:00', required: true })
  time: string;

  /**
   * За какой период считать отчёт: `today` | `week` | `month`.
   *
   * Конкретной даты здесь быть не может — в ежедневной задаче она означала бы
   * отчёт, который завтра пришлёт ровно те же числа, что сегодня. Осмысленны
   * только периоды, отсчитываемые от «сейчас» (см. SCHEDULE_PERIODS).
   */
  @Prop({ type: String, default: 'today', required: true })
  period: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const ReportScheduleSchema = SchemaFactory.createForClass(ReportSchedule);

// Одна настройка на отчёт: дубли отсекает база, а не проверка в коде.
ReportScheduleSchema.index({ telegramUserId: 1, botId: 1, reportKey: 1 }, { unique: true });

// Под сверку расписаний при старте (TASK-031).
ReportScheduleSchema.index({ enabled: 1 });
