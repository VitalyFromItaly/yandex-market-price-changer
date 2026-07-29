import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ReportSchedule,
  ReportScheduleDocument,
} from '../schemas/report-schedule.schema';
import {
  DEFAULT_SCHEDULE_TIME,
  parseScheduleTime,
} from '../../modules/yandex/reports/schedule-time';

export interface IScheduleKey {
  telegramUserId: string;
  botId: string;
  reportKey: string;
}

/**
 * Настройки ежедневной рассылки.
 *
 * Все запросы скоупятся по telegramUserId: сервис мультитенантный, и чужое
 * расписание не должно быть видно даже случайно.
 */
@Injectable()
export class ReportScheduleService {
  private readonly logger = new Logger(ReportScheduleService.name);

  constructor(
    @InjectModel(ReportSchedule.name)
    private readonly model: Model<ReportScheduleDocument>,
  ) {}

  /** Все настройки пользователя. Отсутствующие означают «выключено». */
  async listForUser(
    telegramUserId: string,
    botId: string,
  ): Promise<ReportScheduleDocument[]> {
    return await this.model.find({ telegramUserId, botId }).exec();
  }

  async findOne(key: IScheduleKey): Promise<ReportScheduleDocument | null> {
    return await this.model.findOne(key).exec();
  }

  /**
   * Задать время. Некорректное значение не сохраняется — ошибка возвращается
   * вызывающему, чтобы он переспросил пользователя.
   */
  async setTime(
    key: IScheduleKey,
    input: string,
  ): Promise<{ ok: boolean; error?: string; schedule?: ReportScheduleDocument }> {
    const parsed = parseScheduleTime(input);
    if (!parsed.ok) return { ok: false, error: parsed.error };

    const schedule = await this.model
      .findOneAndUpdate(
        key,
        {
          $set: { time: parsed.time.value },
          // Включение — отдельное действие: задать время, не включив рассылку,
          // должно быть возможно.
          $setOnInsert: { enabled: false },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();

    return { ok: true, schedule };
  }

  /** Включить или выключить. Время по умолчанию — если его ещё не задавали. */
  async setEnabled(
    key: IScheduleKey,
    enabled: boolean,
  ): Promise<ReportScheduleDocument> {
    return await this.model
      .findOneAndUpdate(
        key,
        {
          $set: { enabled },
          $setOnInsert: { time: DEFAULT_SCHEDULE_TIME },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  /** Все включённые расписания — для сверки при старте приложения (TASK-031). */
  async listEnabled(): Promise<ReportScheduleDocument[]> {
    return await this.model.find({ enabled: true }).exec();
  }
}
