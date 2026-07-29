import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bull';

import { ReportScheduleService } from '../../../../database/services/report-schedule.service';
import { MOSCOW_TIME_ZONE } from '../../../yandex/reports/moscow-day';
import { toCron } from '../../../yandex/reports/schedule-time';
import { QUEUE_NAMES, JOB_TYPES } from '../../index';

export interface IScheduleKey {
  telegramUserId: string;
  botId: string;
  reportKey: string;
}

/**
 * Payload задачи — ТОЛЬКО ключ. Чат получателя намеренно не кладётся: между
 * созданием расписания и запуском проходят сутки, и адрес нужно брать свежим
 * из записи доступа, а не из задачи месячной давности.
 */
export type IScheduledReportJob = IScheduleKey;

/**
 * Планировщик ежедневной рассылки на repeatable-задачах Bull.
 *
 * Отдельный планировщик не нужен: Redis уже поднят под очереди. Часовой пояс
 * задаётся Bull'у явно (`tz`), а не пересчитывается в UTC руками — иначе при
 * любом изменении правил пояса рассылка, заданная на 9 утра, молча уехала бы.
 */
@Injectable()
export class ReportSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReportSchedulerService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.REPORTS) private readonly queue: Queue,
    private readonly schedules: ReportScheduleService,
  ) {}

  /**
   * Идентификатор задачи выводится из пользователя, бота и отчёта — он
   * стабилен между запусками. Случайный id означал бы, что повторное включение
   * добавляет ВТОРУЮ задачу и отчёт начинает приходить дважды в день.
   */
  public static jobId(key: IScheduleKey): string {
    return `report:${key.botId}:${key.telegramUserId}:${key.reportKey}`;
  }

  /**
   * Сверка при старте: расписания в Redis приводятся в соответствие с Mongo.
   *
   * Без неё после рестарта возможны обе беды сразу — потерянные рассылки у
   * тех, кто её включил, и осиротевшие задачи у тех, кто выключил.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.reconcile();
    } catch (error) {
      // Сверка не должна мешать приложению подняться: без неё бот работает,
      // просто расписания могут разъехаться до следующего старта.
      this.logger.error('Не удалось сверить расписания рассылки', error as Error);
    }
  }

  public async reconcile(): Promise<{ added: number; removed: number }> {
    const enabled = await this.schedules.listEnabled();

    // Только три поля: документ Mongo целиком в payload задачи попасть не должен.
    const wanted = new Map<string, { key: IScheduleKey; time: string }>();
    for (const doc of enabled) {
      const key: IScheduleKey = {
        telegramUserId: doc.telegramUserId,
        botId: doc.botId,
        reportKey: doc.reportKey,
      };
      wanted.set(ReportSchedulerService.jobId(key), { key, time: doc.time });
    }

    const existing = await this.queue.getRepeatableJobs();
    let removed = 0;

    for (const job of existing) {
      const target = wanted.get(job.id);

      if (target && job.cron === toCron(target.time)) {
        // Задача на месте и время совпадает — трогать нечего.
        wanted.delete(job.id);
        continue;
      }

      // Либо рассылку выключили, либо изменили время: снимаем по ключу, потому
      // что cron прежней задачи нам уже неизвестен. Если время изменилось,
      // запись остаётся в wanted и задача пересоздастся ниже.
      await this.queue.removeRepeatableByKey(job.key);
      removed += 1;
    }

    let added = 0;
    for (const { key, time } of wanted.values()) {
      await this.schedule(key, time);
      added += 1;
    }

    if (added || removed) {
      this.logger.log(`Расписания сверены: создано ${added}, снято ${removed}`);
    }
    return { added, removed };
  }

  /** Создать или перенести задачу. Старая снимается, дубля не остаётся. */
  public async schedule(key: IScheduleKey, time: string): Promise<void> {
    await this.unschedule(key);

    await this.queue.add(
      JOB_TYPES.SEND_SCHEDULED_REPORT,
      {
        telegramUserId: key.telegramUserId,
        botId: key.botId,
        reportKey: key.reportKey,
      },
      {
        jobId: ReportSchedulerService.jobId(key),
        repeat: { cron: toCron(time), tz: MOSCOW_TIME_ZONE },
        removeOnComplete: 20,
        removeOnFail: 50,
        // Одна попытка: следующий запуск всё равно через сутки, а бесконечные
        // повторы упавшего отчёта жгли бы часовую квоту Partner API.
        attempts: 1,
      },
    );

    this.logger.log(`Расписание ${ReportSchedulerService.jobId(key)} на ${time} МСК`);
  }

  /** Снять задачу. Снимаем по ключу — прежнее время может быть неизвестно. */
  public async unschedule(key: IScheduleKey): Promise<void> {
    const id = ReportSchedulerService.jobId(key);
    const jobs = await this.queue.getRepeatableJobs();

    for (const job of jobs) {
      if (job.id === id) await this.queue.removeRepeatableByKey(job.key);
    }
  }
}
