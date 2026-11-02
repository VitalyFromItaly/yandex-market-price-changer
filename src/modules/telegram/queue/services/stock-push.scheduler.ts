import type { TPushInterval } from '../../../stock-push/stock-push-interval';
import type { TFeatureMap } from '../../bots/shared/features.domain';
import type { IScheduledStockPushJob } from '../processors/stock-sync.processor';

import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bull';

import { ActionLogService } from '../../../../database/services/action-log.service';
import { StockPushSettingsService } from '../../../../database/services/stock-push-settings.service';
import { UserAccessService } from '../../../../database/services/user-access.service';
import { ErrorReporter } from '../../../errors/error-reporter.service';
import { eventWindowOf } from '../../../stock-push/marketplace-events';
import { pushCronOf } from '../../../stock-push/stock-push-interval';
import { STOCK_PUSH_SCHEDULE_LOG_KIND } from '../../../stock-push/stock-push.service';
import { MOSCOW_TIME_ZONE } from '../../../yandex/reports/moscow-day';
import { FEATURE, isFeatureEnabled } from '../../bots/shared/features.domain';
import { JOB_TYPES, QUEUE_NAMES } from '../../index';

import {
  parsePushJobId,
  pickPushUsers,
  pushAfterPriceListJobId,
  pushEventJobId,
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

/** Расписание продавца для CRM: частота, следующий запуск и итог последнего прохода. */
export interface IPushScheduleStatus {
  interval: TPushInterval;
  /** null — задачи нет (выключено, закрыто или сверка ещё не прошла). */
  nextRunAt: string | null;
  lastRun: { at: string; status: string; action: string } | null;
}

/**
 * «Передача остатков» по расписанию (TASK-176) — по ОДНОЙ повторяемой задаче на
 * продавца в очереди `file-processing`, с частотой продавца (`StockPushSettings`,
 * умолчание — каждые 30 минут; «выключена» — задачи нет). Очередь общая с прайсом
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
    private readonly settings: StockPushSettingsService,
    private readonly actionLog: ActionLogService,
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

  /** Фичи для прохода после прайса из бота; null — не положен (расписание не требуется). */
  async featuresAfterPriceList(telegramUserId: string): Promise<TFeatureMap | null> {
    const accounts = await this.access.findByLogin(telegramUserId);
    return pickPushUsers(accounts, { requireSchedule: false }).get(telegramUserId) ?? null;
  }

  /**
   * Фичи для прохода по уведомлению площадки; null — не положен. Нужны те же
   * права, что расписанию, и `stock_push_events` сверху.
   */
  async featuresAfterEvent(telegramUserId: string): Promise<TFeatureMap | null> {
    const features = await this.featuresFor(telegramUserId);
    return features && isFeatureEnabled(features, FEATURE.STOCK_PUSH_EVENTS) ? features : null;
  }

  /**
   * Проход по уведомлению о заказе (`stock_push_on_marketplace_event`) — в конце окна
   * склейки: пачка заказов даёт один проход. Повтор id в окне Bull не ставит.
   * Доступ процессор перепроверит (`featuresAfterEvent`).
   */
  async sendAfterEvent(telegramUserId: string, now: number = Date.now()): Promise<void> {
    const { window, delayMs } = eventWindowOf(now);
    const payload: IScheduledStockPushJob = {
      source: 'schedule',
      telegramUserId,
      trigger: 'event',
    };
    await this.queue.add(JOB_TYPES.SYNC_STOCKS, payload, {
      jobId: pushEventJobId(telegramUserId, window),
      delay: delayMs,
      removeOnComplete: true,
      removeOnFail: true,
      attempts: 1,
    });
  }

  /**
   * Свести задачи `stockpush-*` к `wanted()` с частотой продавца: совпали id и
   * cron — оставить, иначе снять (сменили частоту — задача пересоздаётся);
   * недостающие — завести, «выключена» — не заводить. Прайс, кнопка и мёртвый
   * конвейер той же очереди не трогаются.
   */
  async reconcile(): Promise<{ added: number; removed: number }> {
    const users = [...(await this.wanted()).keys()];
    const intervals = await this.settings.intervalsFor(users);
    const wanted = new Map<string, string>();
    for (const id of users) {
      const cron = pushCronOf(intervals.get(id));
      if (cron) wanted.set(pushJobId(id), cron);
    }
    let removed = 0;

    for (const job of await this.queue.getRepeatableJobs()) {
      if (!parsePushJobId(job.id)) continue;
      if (job.id && wanted.get(job.id) === job.cron) {
        wanted.delete(job.id);
        continue;
      }
      await this.queue.removeRepeatableByKey(job.key);
      removed += 1;
    }

    for (const [jobId, cron] of wanted) {
      const payload: IScheduledStockPushJob = {
        source: 'schedule',
        telegramUserId: parsePushJobId(jobId) ?? '',
      };
      await this.queue.add(JOB_TYPES.SYNC_STOCKS, payload, {
        jobId,
        repeat: { cron, tz: MOSCOW_TIME_ZONE },
        removeOnComplete: 20,
        removeOnFail: 50,
        // Одна попытка (умолчание очереди — 2): повтор записи остатков жёг бы
        // квоты, а следующий проход всё равно пересчитает план.
        attempts: 1,
      });
    }

    return { added: wanted.size, removed };
  }

  /**
   * Частота продавца из CRM: записать и сразу сверить — новая частота действует
   * с ближайшего слота, без рестарта.
   */
  async setInterval(telegramUserId: string, interval: TPushInterval): Promise<IPushScheduleStatus> {
    await this.settings.setInterval(telegramUserId, interval);
    await this.refresh();
    return await this.statusFor(telegramUserId);
  }

  /** Для экрана CRM: следующий запуск — из задачи продавца, итог — последняя строка журнала прохода. */
  async statusFor(telegramUserId: string): Promise<IPushScheduleStatus> {
    const [interval, jobs, runs] = await Promise.all([
      this.settings.intervalOf(telegramUserId),
      this.jobs(),
      this.actionLog.list({ telegramUserId, kind: STOCK_PUSH_SCHEDULE_LOG_KIND, limit: 1 }),
    ]);
    const job = jobs.find((row) => row.telegramUserId === telegramUserId);
    const [last] = runs;
    return {
      interval,
      nextRunAt: job?.next ? new Date(job.next).toISOString() : null,
      lastRun: last
        ? {
            at: (last.createdAt ?? new Date()).toISOString(),
            status: last.status,
            action: last.action,
          }
        : null,
    };
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

  /**
   * Проход сразу после прайса из бота (решение `stock_push_after_bot_price_list`):
   * бот уже записал ЯМ числами файла, а Ozon/WB без него ждали бы расписания.
   * Доступ процессор перепроверит (`featuresAfterPriceList`). Чат — чтобы
   * прислать итог; токена в payload нет. Тот же id, пока ждёт, — два прайса
   * подряд дают один проход, и он читает последний.
   */
  async sendAfterPriceList(telegramUserId: string, botId: number, chatId: string): Promise<void> {
    const payload: IScheduledStockPushJob = {
      source: 'schedule',
      telegramUserId,
      trigger: 'price-list',
      botId,
      chatId,
    };
    await this.queue.add(JOB_TYPES.SYNC_STOCKS, payload, {
      jobId: pushAfterPriceListJobId(telegramUserId),
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
