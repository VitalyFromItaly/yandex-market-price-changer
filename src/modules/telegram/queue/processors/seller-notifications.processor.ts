import type { INotificationsCheckResult } from '../../../notifications/notifications.service';
import type { TFeatureMap } from '../../bots/shared/features.domain';

import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

import { AppConfigService } from '../../../../config/app-config.service';
import { ActionLogService } from '../../../../database/services/action-log.service';
import { SellerNotificationSettingsService } from '../../../../database/services/seller-notification-settings.service';
import { SellerNotificationService } from '../../../../database/services/seller-notification.service';
import { UserAccessService } from '../../../../database/services/user-access.service';
import { ErrorReporter } from '../../../errors/error-reporter.service';
import { NotificationsService } from '../../../notifications/notifications.service';
import { telegramDigest } from '../../../notifications/notifications.text';
import { BotRegistry } from '../../bots/bot-registry.service';
import { FEATURE, allFeaturesEnabled, isFeatureEnabled } from '../../bots/shared/features.domain';
import { htmlOptions } from '../../formatting/telegram-format';
import { JOB_TYPES, QUEUE_NAMES } from '../../index';
import { SellerNotificationsScheduler } from '../services/seller-notifications.scheduler';

/**
 * Payload: продавец и вид запуска — и всё. Токена нет: креды перечитываются
 * из Mongo (довод stock-sync). Два вида под ОДНИМ именем джобы — второй
 * `@Process` на очереди суммировал бы concurrency (урок TASK-080).
 */
export type ISellerNotificationsJob =
  | { telegramUserId: string; scheduled: true }
  | { telegramUserId: string; manual: true };

export const SELLER_NOTIFICATIONS_LOG_KIND = 'seller-notifications';

export interface ISellerNotificationsRun {
  skipped?: 'not-eligible';
  created: number;
  resolved: number;
  /** Сколько чатов получили сводку. */
  sent: number;
}

/**
 * Единственный обработчик очереди `seller-notifications`, concurrency 1: сборка
 * склада ходит в API площадок, два продавца разом делили бы одни квоты.
 *
 * Отправка — в каждый одобренный чат продавца через его бота. Ошибка
 * отправки (403 — продавец заблокировал бота) не роняет задачу: уведомления
 * уже в CRM, остальные чаты получают своё (довод HostingReminderProcessor.send).
 */
@Processor(QUEUE_NAMES.SELLER_NOTIFICATIONS)
export class SellerNotificationsProcessor {
  private readonly logger = new Logger(SellerNotificationsProcessor.name);

  constructor(
    private readonly scheduler: SellerNotificationsScheduler,
    private readonly notifications: NotificationsService,
    private readonly feed: SellerNotificationService,
    private readonly settings: SellerNotificationSettingsService,
    private readonly access: UserAccessService,
    private readonly registry: BotRegistry,
    private readonly actionLog: ActionLogService,
    private readonly config: AppConfigService,
    private readonly errors: ErrorReporter,
  ) {}

  @Process({ name: JOB_TYPES.CHECK_SELLER_NOTIFICATIONS, concurrency: 1 })
  async handle(job: Job<ISellerNotificationsJob>): Promise<ISellerNotificationsRun> {
    const { telegramUserId } = job.data;
    const manual = 'manual' in job.data;
    // Право перепроверяется: задача могла остаться от прошлой сверки, а фичу
    // с тех пор закрыли. Разовая проверка админа (кнопка CRM) — со всеми
    // фичами: флаги админ обходит, а в расписание он не входит.
    const features = await this.featuresOf(telegramUserId, manual);
    if (!features) {
      this.logger.log(`Уведомления ${telegramUserId}: фича закрыта — проверки нет`);
      if (!manual) void this.scheduler.refresh();
      return { skipped: 'not-eligible', created: 0, resolved: 0, sent: 0 };
    }

    const result = await this.notifications.check(telegramUserId, features);
    const sent = await this.deliver(telegramUserId, features, result);
    this.logger.log(
      `Уведомления ${telegramUserId}: новых ${result.created.length}, снято ${result.resolved}, ` +
        `в Telegram ${sent}` +
        (result.skipped.length ? `, пропущено: ${result.skipped.join(', ')}` : ''),
    );
    return { created: result.created.length, resolved: result.resolved, sent };
  }

  private async featuresOf(telegramUserId: string, manual: boolean): Promise<TFeatureMap | null> {
    const features = await this.scheduler.featuresFor(telegramUserId);
    if (features) return features;
    const admin = this.config.telegramAdminIds.map(String).includes(telegramUserId);
    return manual && admin ? allFeaturesEnabled() : null;
  }

  /** Сводка новых уведомлений в Telegram — только при открытой `notifications_telegram` и включённой настройке. */
  private async deliver(
    telegramUserId: string,
    features: TFeatureMap,
    result: INotificationsCheckResult,
  ): Promise<number> {
    if (!result.created.length) return 0;
    if (!isFeatureEnabled(features, FEATURE.NOTIFICATIONS_TELEGRAM)) return 0;
    if (!(await this.settings.get(telegramUserId)).telegram) return 0;

    const text = telegramDigest(result.created);
    const chats = (await this.access.findByLogin(telegramUserId)).filter(
      (row) => row.status === 'approved' && row.telegramChatId,
    );
    let sent = 0;
    for (const row of chats) {
      const bot = this.registry.findByTelegramId(row.botId);
      if (!bot) continue;
      try {
        await bot.telegraf.telegram.sendMessage(row.telegramChatId, text, htmlOptions());
        sent += 1;
        void this.actionLog.record({
          telegramUserId,
          botId: row.botId,
          direction: 'out',
          kind: SELLER_NOTIFICATIONS_LOG_KIND,
          action: `уведомления: ${result.created.length}`,
        });
      } catch (error) {
        // 403 и прочие отказы Telegram: неудачный callApi уже пишет воронка
        // исходящих, алерт админам на каждого заблокировавшего не нужен.
        this.logger.warn(`Уведомления не доставлены ${telegramUserId}: ${String(error)}`);
      }
    }
    if (sent) {
      await this.feed.markSent(
        telegramUserId,
        result.created.map((row) => row.id),
        new Date(),
      );
    }
    return sent;
  }

  @OnQueueFailed()
  onFailed(job: Job<ISellerNotificationsJob>, error: Error): void {
    void this.errors.report({
      error,
      source: 'queue',
      context: 'seller-notifications',
      telegramUserId: job.data?.telegramUserId,
      action: job.data && 'manual' in job.data ? 'проверка по кнопке' : 'по расписанию',
    });
  }
}
