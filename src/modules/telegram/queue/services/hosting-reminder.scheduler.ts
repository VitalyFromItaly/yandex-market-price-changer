import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bull';

import { MOSCOW_TIME_ZONE } from '../../../yandex/reports/moscow-day';
import { JOB_TYPES, QUEUE_NAMES } from '../../index';

/**
 * Расписание напоминания об оплате хостинга — ОДНА глобальная задача.
 *
 * Отдельный планировщик, а не ветка в `ReportSchedulerService`: тот сверяет
 * ПЕРСОНАЛЬНЫЕ расписания с коллекцией `ReportSchedule` — сколько документов,
 * столько задач. Здесь задача одна, и в Mongo ей ничего не соответствует;
 * смешивать «сверка с базой» и «одна задача навсегда» в одном методе значило бы
 * сделать оба непонятными.
 *
 * **Cron не умеет «последний день месяца»**, поэтому будим себя 28–31 числа, а
 * решает `isLastDayOfMonth` в процессоре. Ежедневный cron дал бы 27 холостых
 * пробуждений в месяц вместо трёх и ту же самую проверку в коде.
 */
@Injectable()
export class HostingReminderScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(HostingReminderScheduler.name);

  /**
   * Идентификатор фиксирован. Случайный означал бы ВТОРУЮ задачу на каждом
   * рестарте — то есть два одинаковых напоминания подряд (та же причина, по
   * которой `ReportSchedulerService.jobId` выводится из ключа, а не из random).
   */
  public static readonly JOB_ID = 'hosting-reminder';

  /** Минута, час, дни месяца — 28–31, дальше решает процессор. */
  public static readonly CRON = '0 10 28-31 * *';

  constructor(@InjectQueue(QUEUE_NAMES.REPORTS) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.ensureScheduled();
    } catch (error) {
      // Приложению это подняться не мешает: без задачи не уйдёт напоминание,
      // а не сломается бот (та же политика, что у сверки расписаний).
      this.logger.error('Не удалось завести напоминание об оплате хостинга', error as Error);
    }
  }

  /**
   * Завести задачу, сняв прежнюю с тем же id, но другим cron.
   *
   * Именно «другим cron», а не «любую»: Bull чеканит id тика из ключа задачи и
   * времени тика, поэтому повторное заведение ТОЙ ЖЕ задачи дубля не создаёт, а
   * снятие и добавление на каждом старте зря дёргало бы Redis. А вот смена
   * времени в коде без снятия оставила бы обе задачи — и напоминание приходило
   * бы дважды.
   */
  public async ensureScheduled(): Promise<void> {
    const existing = await this.queue.getRepeatableJobs();
    let alive = false;

    for (const job of existing) {
      if (job.id !== HostingReminderScheduler.JOB_ID) continue;

      if (job.cron === HostingReminderScheduler.CRON) {
        alive = true;
        continue;
      }
      await this.queue.removeRepeatableByKey(job.key);
    }

    if (alive) return;

    await this.queue.add(
      JOB_TYPES.SEND_HOSTING_REMINDER,
      {},
      {
        jobId: HostingReminderScheduler.JOB_ID,
        repeat: { cron: HostingReminderScheduler.CRON, tz: MOSCOW_TIME_ZONE },
        removeOnComplete: 12,
        removeOnFail: 12,
        // Одна попытка: повтор упавшей рассылки прислал бы напоминание второй
        // раз тем, кому оно уже ушло, — рассылка не транзакция.
        attempts: 1,
      },
    );

    this.logger.log(
      `Напоминание об оплате хостинга: ${HostingReminderScheduler.CRON} (${MOSCOW_TIME_ZONE})`,
    );
  }
}
