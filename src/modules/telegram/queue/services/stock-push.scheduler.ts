import type { TFeatureMap } from '../../bots/shared/features.domain';
import type { IScheduledStockPushJob } from '../processors/stock-sync.processor';

import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bull';

import { UserAccessService } from '../../../../database/services/user-access.service';
import { ErrorReporter } from '../../../errors/error-reporter.service';
import { MOSCOW_TIME_ZONE } from '../../../yandex/reports/moscow-day';
import { JOB_TYPES, QUEUE_NAMES } from '../../index';

import {
  PUSH_CRON,
  parsePushJobId,
  pickPushUsers,
  pushJobId,
  pushNowJobId,
} from './stock-push-schedule';

/** Повторяемая задача продавца — то, что видит карточка в панели. */
export interface IPushScheduledJob {
  telegramUserId: string;
  cron: string;
  tz: string;
  next: number;
}

/**
 * «Передача остатков» по расписанию (TASK-176) — по ОДНОЙ повторяемой задаче на
 * продавца в очереди `file-processing`, каждые 30 минут. Очередь общая с прайсом
 * и кнопкой ради «одна запись остатков за раз», и обработчик у неё один
 * (`StockSyncProcessor`, `source: 'schedule'`), поэтому сверка узкая — только id
 * `stockpush-<цифры>`.
 *
 * Сверяется при старте и после правки доступа в панели (`refresh`); процессор
 * всё равно перечитывает фичи в момент прохода.
 */
@Injectable()
export class StockPushScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(StockPushScheduler.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.FILE_PROCESSING) private readonly queue: Queue,
    private readonly access: UserAccessService,
    private readonly errors: ErrorReporter,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const { added, removed } = await this.reconcile();
      this.logger.log(`Передача остатков по расписанию: +${added} −${removed}`);
    } catch (error) {
      // Подняться приложению это не мешает (политика остальных планировщиков).
      this.logger.error('Не удалось сверить расписание передачи остатков', error as Error);
    }
  }

  /** Кому положен проход — и с какими фичами (из строки доступа). */
  async wanted(): Promise<Map<string, TFeatureMap>> {
    return pickPushUsers(await this.access.list());
  }

  /** Фичи одного продавца на момент прохода; null — проход не положен. */
  async featuresFor(telegramUserId: string): Promise<TFeatureMap | null> {
    return pickPushUsers(await this.access.findByLogin(telegramUserId)).get(telegramUserId) ?? null;
  }

  /**
   * Свести задачи `stockpush-*` к `wanted()`: совпали id и cron — оставить,
   * иначе снять; недостающие — завести. Прайс, кнопка и мёртвый конвейер той же
   * очереди не трогаются.
   */
  async reconcile(): Promise<{ added: number; removed: number }> {
    const wanted = new Set([...(await this.wanted()).keys()].map(pushJobId));
    let removed = 0;

    for (const job of await this.queue.getRepeatableJobs()) {
      if (!parsePushJobId(job.id)) continue;
      if (job.id && wanted.has(job.id) && job.cron === PUSH_CRON) {
        wanted.delete(job.id);
        continue;
      }
      await this.queue.removeRepeatableByKey(job.key);
      removed += 1;
    }

    for (const jobId of wanted) {
      const payload: IScheduledStockPushJob = {
        source: 'schedule',
        telegramUserId: parsePushJobId(jobId) ?? '',
      };
      await this.queue.add(JOB_TYPES.SYNC_STOCKS, payload, {
        jobId,
        repeat: { cron: PUSH_CRON, tz: MOSCOW_TIME_ZONE },
        removeOnComplete: 20,
        removeOnFail: 50,
        // Одна попытка (умолчание очереди — 2): повтор записи остатков жёг бы
        // квоты, а следующий проход через 30 минут всё равно пересчитает план.
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
      void this.errors.report({ error, source: 'queue', context: 'stock-push:schedule' });
    }
  }

  /**
   * Разовый проход по кнопке панели — то же правило доступа, что у расписания
   * (процессор перепроверит). Тот же id, пока задача ждёт, — Bull не ставит
   * вторую (двойной клик); после завершения задача удаляется.
   */
  async sendNow(telegramUserId: string): Promise<void> {
    const payload: IScheduledStockPushJob = { source: 'schedule', telegramUserId, manual: true };
    await this.queue.add(JOB_TYPES.SYNC_STOCKS, payload, {
      jobId: pushNowJobId(telegramUserId),
      removeOnComplete: true,
      removeOnFail: true,
      attempts: 1,
    });
  }

  /** Заведённые задачи — для карточки «Очереди». */
  async jobs(): Promise<IPushScheduledJob[]> {
    const rows: IPushScheduledJob[] = [];
    for (const job of await this.queue.getRepeatableJobs()) {
      const telegramUserId = parsePushJobId(job.id);
      if (telegramUserId) rows.push({ telegramUserId, cron: job.cron, tz: job.tz, next: job.next });
    }
    return rows;
  }
}
