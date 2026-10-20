import type { TFeatureMap } from '../../bots/shared/features.domain';
import type { IWeeklyDigestJob } from '../processors/weekly-digest.processor';

import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bull';

import { UserAccessService } from '../../../../database/services/user-access.service';
import { YandexMarketService } from '../../../../database/services/yandex-market.service';
import { ErrorReporter } from '../../../errors/error-reporter.service';
import { MOSCOW_TIME_ZONE } from '../../../yandex/reports/moscow-day';
import { JOB_TYPES, QUEUE_NAMES } from '../../index';

import {
  DIGEST_CRON,
  digestJobId,
  digestNowJobId,
  parseDigestJobId,
  pickDigestUsers,
} from './weekly-digest-schedule';

/** Повторяемая задача продавца — то, что видит карточка в панели. */
export interface IDigestScheduledJob {
  telegramUserId: string;
  cron: string;
  tz: string;
  next: number;
}

/**
 * Еженедельная ИИ-сводка (TASK-168) — по ОДНОЙ повторяемой задаче на продавца
 * в своей очереди `ai-weekly-digest`, понедельник 10:00 МСК. Сверка узкая —
 * только id `weeklydigest-<цифры>`.
 *
 * Сверяется при старте и после правки доступа в панели (`refresh`);
 * процессор всё равно перепроверяет право.
 */
@Injectable()
export class WeeklyDigestScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(WeeklyDigestScheduler.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.AI_WEEKLY_DIGEST) private readonly queue: Queue,
    private readonly access: UserAccessService,
    private readonly stores: YandexMarketService,
    private readonly errors: ErrorReporter,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const { added, removed } = await this.reconcile();
      this.logger.log(`ИИ-сводка недели по расписанию: +${added} −${removed}`);
    } catch (error) {
      // Подняться приложению это не мешает (политика остальных планировщиков).
      this.logger.error('Не удалось сверить расписание ИИ-сводки', error as Error);
    }
  }

  private async pick(
    accounts: Awaited<ReturnType<UserAccessService['list']>>,
  ): Promise<Map<string, TFeatureMap>> {
    const ids = [...new Set(accounts.map((a) => a.telegramUserId))];
    if (!ids.length) return new Map();
    const configured = new Set(
      (await this.stores.findByTelegramUsers(ids))
        .filter((store) => store.campaign_id && store.business_id && store.token)
        .map((store) => store.telegramUserId),
    );
    return pickDigestUsers(accounts, configured);
  }

  /** Кому положена сводка — и с какими фичами (из строки доступа). */
  async wanted(): Promise<Map<string, TFeatureMap>> {
    return this.pick(await this.access.list());
  }

  /** Фичи одного продавца для перепроверки процессора; null — сводка не положена. */
  async featuresFor(telegramUserId: string): Promise<TFeatureMap | null> {
    return (
      (await this.pick(await this.access.findByLogin(telegramUserId))).get(telegramUserId) ?? null
    );
  }

  /**
   * Свести задачи `weeklydigest-*` к `wanted()`: совпали id и cron — оставить,
   * иначе снять; недостающие — завести. Чужие повторяемые задачи не трогаются.
   */
  async reconcile(): Promise<{ added: number; removed: number }> {
    const wanted = new Set([...(await this.wanted()).keys()].map(digestJobId));
    let removed = 0;

    for (const job of await this.queue.getRepeatableJobs()) {
      if (!parseDigestJobId(job.id)) continue;
      if (job.id && wanted.has(job.id) && job.cron === DIGEST_CRON) {
        wanted.delete(job.id);
        continue;
      }
      await this.queue.removeRepeatableByKey(job.key);
      removed += 1;
    }

    for (const jobId of wanted) {
      const payload: IWeeklyDigestJob = {
        telegramUserId: parseDigestJobId(jobId) ?? '',
        scheduled: true,
      };
      await this.queue.add(JOB_TYPES.SEND_AI_WEEKLY_DIGEST, payload, {
        jobId,
        repeat: { cron: DIGEST_CRON, tz: MOSCOW_TIME_ZONE },
        removeOnComplete: 20,
        removeOnFail: 50,
        // Одна попытка: повтор — второй платный запрос к Polza и, возможно, второе сообщение.
        attempts: 1,
      });
    }

    return { added: wanted.size, removed };
  }

  /**
   * Сверка «по событию» — правка доступа в панели. Не бросает: настройка уже
   * записана, и отвечать «не получилось» из-за Redis значило бы соврать.
   */
  async refresh(): Promise<void> {
    try {
      await this.reconcile();
    } catch (error) {
      void this.errors.report({ error, source: 'queue', context: 'ai-weekly-digest:schedule' });
    }
  }

  /**
   * Разовая отправка по кнопке панели. Тот же id, пока задача ждёт, — Bull не
   * ставит вторую (двойной клик); после завершения задача удаляется.
   */
  async sendNow(telegramUserId: string): Promise<void> {
    const payload: IWeeklyDigestJob = { telegramUserId, manual: true };
    await this.queue.add(JOB_TYPES.SEND_AI_WEEKLY_DIGEST, payload, {
      jobId: digestNowJobId(telegramUserId),
      removeOnComplete: true,
      removeOnFail: true,
      attempts: 1,
    });
  }

  /** Заведённые задачи — для карточки «Очереди». */
  async jobs(): Promise<IDigestScheduledJob[]> {
    const rows: IDigestScheduledJob[] = [];
    for (const job of await this.queue.getRepeatableJobs()) {
      const telegramUserId = parseDigestJobId(job.id);
      if (telegramUserId) rows.push({ telegramUserId, cron: job.cron, tz: job.tz, next: job.next });
    }
    return rows;
  }
}
