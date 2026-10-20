import type { TFeatureMap } from '../../bots/shared/features.domain';
import type { ISellerNotificationsJob } from '../processors/seller-notifications.processor';

import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bull';

import { SellerNotificationSettingsService } from '../../../../database/services/seller-notification-settings.service';
import { UserAccessService } from '../../../../database/services/user-access.service';
import { ErrorReporter } from '../../../errors/error-reporter.service';
import { MOSCOW_TIME_ZONE } from '../../../yandex/reports/moscow-day';
import { DEFAULT_SCHEDULE_TIME } from '../../../yandex/reports/schedule-time';
import { JOB_TYPES, QUEUE_NAMES } from '../../index';

import {
  notifyCron,
  notifyJobId,
  notifyNowJobId,
  parseNotifyJobId,
  pickNotificationUsers,
} from './seller-notifications-schedule';

/** Повторяемая задача продавца — то, что видит карточка в панели. */
export interface INotifyScheduledJob {
  telegramUserId: string;
  cron: string;
  tz: string;
  next: number;
}

/**
 * Ежедневная проверка уведомлений (TASK-152) — по ОДНОЙ повторяемой задаче на
 * продавца в очереди `seller-notifications`, в его время (решение
 * `notifications_daily_seller_time`).
 *
 * Очередь своя (решение `notifications_own_queue`): `notifications` занята
 * прогрессом загрузки прайса, а на `reports` сверка ReportScheduler снимает
 * чужие задачи. Сверка здесь узкая — только id `notify-<цифры>`.
 *
 * Сверяется при старте, после правки доступа в панели и после смены времени
 * продавцом (`refresh`); процессор всё равно перепроверяет право.
 */
@Injectable()
export class SellerNotificationsScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(SellerNotificationsScheduler.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.SELLER_NOTIFICATIONS) private readonly queue: Queue,
    private readonly access: UserAccessService,
    private readonly settings: SellerNotificationSettingsService,
    private readonly errors: ErrorReporter,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const { added, removed } = await this.reconcile();
      this.logger.log(`Проверка уведомлений по расписанию: +${added} −${removed}`);
    } catch (error) {
      // Подняться приложению это не мешает (политика остальных планировщиков).
      this.logger.error('Не удалось сверить расписание уведомлений', error as Error);
    }
  }

  /** Кому положена проверка — и с какими фичами (из строки доступа). */
  async wanted(): Promise<Map<string, TFeatureMap>> {
    return pickNotificationUsers(await this.access.list());
  }

  /** Фичи одного продавца для перепроверки процессора; null — проверка не положена. */
  async featuresFor(telegramUserId: string): Promise<TFeatureMap | null> {
    const rows = await this.access.findByLogin(telegramUserId);
    return pickNotificationUsers(rows).get(telegramUserId) ?? null;
  }

  /**
   * Свести задачи `notify-*` к `wanted()` с cron из времени продавца: совпали
   * id и cron — оставить, иначе снять; недостающие — завести. Чужие
   * повторяемые задачи очереди не трогаются.
   */
  async reconcile(): Promise<{ added: number; removed: number }> {
    const users = [...(await this.wanted()).keys()];
    const times = await this.settings.timesFor(users);
    const wanted = new Map(
      users.map((id) => [notifyJobId(id), notifyCron(times.get(id), DEFAULT_SCHEDULE_TIME)]),
    );
    let removed = 0;

    for (const job of await this.queue.getRepeatableJobs()) {
      if (!parseNotifyJobId(job.id)) continue;
      if (job.id && wanted.get(job.id) === job.cron) {
        wanted.delete(job.id);
        continue;
      }
      await this.queue.removeRepeatableByKey(job.key);
      removed += 1;
    }

    for (const [jobId, cron] of wanted) {
      const payload: ISellerNotificationsJob = {
        telegramUserId: parseNotifyJobId(jobId) ?? '',
        scheduled: true,
      };
      await this.queue.add(JOB_TYPES.CHECK_SELLER_NOTIFICATIONS, payload, {
        jobId,
        repeat: { cron, tz: MOSCOW_TIME_ZONE },
        removeOnComplete: 20,
        removeOnFail: 50,
        // Одна попытка: завтра проверка повторится сама, а повтор ходит в API площадок.
        attempts: 1,
      });
    }

    return { added: wanted.size, removed };
  }

  /**
   * Сверка «по событию» — правка доступа в панели или смена времени. Не
   * бросает: настройка уже записана, и отвечать «не получилось» из-за Redis
   * значило бы соврать.
   */
  async refresh(): Promise<void> {
    try {
      await this.reconcile();
    } catch (error) {
      void this.errors.report({ error, source: 'queue', context: 'seller-notifications:schedule' });
    }
  }

  /**
   * Разовая проверка по кнопке CRM. Тот же id, пока задача ждёт, — Bull не
   * ставит вторую (двойной клик); после завершения задача удаляется, и
   * следующий клик ставит новую.
   */
  async checkNow(telegramUserId: string): Promise<void> {
    const payload: ISellerNotificationsJob = { telegramUserId, manual: true };
    await this.queue.add(JOB_TYPES.CHECK_SELLER_NOTIFICATIONS, payload, {
      jobId: notifyNowJobId(telegramUserId),
      removeOnComplete: true,
      removeOnFail: true,
      attempts: 1,
    });
  }

  /** Заведённые задачи — для карточки «Очереди». */
  async jobs(): Promise<INotifyScheduledJob[]> {
    const rows: INotifyScheduledJob[] = [];
    for (const job of await this.queue.getRepeatableJobs()) {
      const telegramUserId = parseNotifyJobId(job.id);
      if (telegramUserId) rows.push({ telegramUserId, cron: job.cron, tz: job.tz, next: job.next });
    }
    return rows;
  }
}
