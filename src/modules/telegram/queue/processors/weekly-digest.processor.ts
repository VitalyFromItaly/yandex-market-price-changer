import type { TFeatureMap } from '../../bots/shared/features.domain';

import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

import { AppConfigService } from '../../../../config/app-config.service';
import { ActionLogService } from '../../../../database/services/action-log.service';
import { UserAccessService } from '../../../../database/services/user-access.service';
import { AiDailyLimitError, AiError } from '../../../ai/ai.errors';
import { PolzaApiError } from '../../../ai/polza.errors';
import { WeeklyDigestService } from '../../../ai-analyst/weekly-digest.service';
import { ErrorReporter } from '../../../errors/error-reporter.service';
import { BotRegistry } from '../../bots/bot-registry.service';
import { FEATURE, allFeaturesEnabled, isFeatureEnabled } from '../../bots/shared/features.domain';
import { htmlOptions } from '../../formatting/telegram-format';
import { JOB_TYPES, QUEUE_NAMES } from '../../index';
import { WeeklyDigestScheduler } from '../services/weekly-digest.scheduler';
import { weeklyDigestMessages } from '../services/weekly-digest.text';

/**
 * Payload: продавец и вид запуска — и всё. Токена нет (довод stock-sync). Два
 * вида под ОДНИМ именем джобы — второй `@Process` суммировал бы concurrency.
 */
export type IWeeklyDigestJob =
  | { telegramUserId: string; scheduled: true }
  | { telegramUserId: string; manual: true };

export const WEEKLY_DIGEST_LOG_KIND = 'ai-weekly-digest';

/** Строки журнала — только статус и счётчики: текста промпта и ответа там нет (правило TASK-104). */
export const DIGEST_LOG = {
  sent: (sent: number, chats: number) => `ИИ-сводка: отправлено ${sent} из ${chats}`,
  noJournal: 'ИИ-сводка: пропущено: нет данных',
  limit: 'ИИ-сводка: пропущено: дневной лимит ИИ исчерпан',
  aiFailed: 'ИИ-сводка: не отправлена: ИИ недоступен',
  noChats: 'ИИ-сводка: пропущено: нет одобренного чата',
} as const;

export interface IWeeklyDigestRun {
  skipped?: 'not-eligible' | 'no-journal' | 'ai-limit' | 'ai-failed';
  /** Сколько чатов получили сводку. */
  sent: number;
}

/**
 * Единственный обработчик очереди `ai-weekly-digest`, concurrency 1: продавцы
 * идут по одному, запросы к Polza не летят пачкой в одну минуту.
 *
 * Итог каждого запуска — строка `ActionLog` вида `ai-weekly-digest`: по ней
 * карточка «Очередей» отвечает, ушла ли сводка и почему нет (урок
 * hosting-reminder). Ошибка отправки (403 — бот заблокирован) не роняет задачу
 * и не будит админов: остальные чаты получают своё.
 */
@Processor(QUEUE_NAMES.AI_WEEKLY_DIGEST)
export class WeeklyDigestProcessor {
  private readonly logger = new Logger(WeeklyDigestProcessor.name);

  constructor(
    private readonly scheduler: WeeklyDigestScheduler,
    private readonly digest: WeeklyDigestService,
    private readonly access: UserAccessService,
    private readonly registry: BotRegistry,
    private readonly actionLog: ActionLogService,
    private readonly config: AppConfigService,
    private readonly errors: ErrorReporter,
  ) {}

  @Process({ name: JOB_TYPES.SEND_AI_WEEKLY_DIGEST, concurrency: 1 })
  async handle(job: Job<IWeeklyDigestJob>): Promise<IWeeklyDigestRun> {
    const { telegramUserId } = job.data;
    const manual = 'manual' in job.data;
    // Право перепроверяется: задача могла остаться от прошлой сверки, а фичу
    // с тех пор закрыли. Разовая отправка админу (кнопка панели) — со всеми
    // фичами: флаги админ обходит, а в расписание он не входит.
    const features = await this.featuresOf(telegramUserId, manual);
    if (!features) {
      this.logger.log(`ИИ-сводка ${telegramUserId}: фича закрыта — сводки нет`);
      if (!manual) void this.scheduler.refresh();
      return { skipped: 'not-eligible', sent: 0 };
    }

    const chats = (await this.access.findByLogin(telegramUserId)).filter(
      (row) => row.status === 'approved' && row.telegramChatId,
    );
    // Чат админа без строки доступа — его личка в первом боте.
    const targets = chats.length
      ? chats.map((row) => ({ botId: row.botId, chatId: row.telegramChatId }))
      : this.adminTargets(telegramUserId, manual);
    const logBot = targets[0]?.botId ?? String(this.registry.first()?.telegramId ?? '');
    const log = (action: string) =>
      this.actionLog.record({
        telegramUserId,
        botId: logBot,
        direction: 'out',
        kind: WEEKLY_DIGEST_LOG_KIND,
        action,
      });
    if (!targets.length) {
      await log(DIGEST_LOG.noChats);
      return { skipped: 'not-eligible', sent: 0 };
    }

    let result: Awaited<ReturnType<WeeklyDigestService['build']>>;
    try {
      result = await this.digest.build({
        telegramUserId,
        aiAllowed: isFeatureEnabled(features, FEATURE.AI),
      });
    } catch (error) {
      // Отказ AiService и сбой Polza — не наша поломка: Polza `AiService` уже
      // отрепортил, лимит — штатный отказ. Причина — в журнал, задача завершена.
      if (error instanceof AiDailyLimitError) {
        await log(DIGEST_LOG.limit);
        return { skipped: 'ai-limit', sent: 0 };
      }
      if (error instanceof AiError || error instanceof PolzaApiError) {
        await log(DIGEST_LOG.aiFailed);
        return { skipped: 'ai-failed', sent: 0 };
      }
      throw error;
    }

    if (result.kind === 'skipped') {
      await log(DIGEST_LOG.noJournal);
      return { skipped: 'no-journal', sent: 0 };
    }

    const messages = weeklyDigestMessages(
      result.week,
      result.answer,
      result.verification,
      result.gaps,
    );
    let sent = 0;
    for (const target of targets) {
      const bot = this.registry.findByTelegramId(target.botId);
      if (!bot) continue;
      try {
        for (const text of messages) {
          await bot.telegraf.telegram.sendMessage(target.chatId, text, htmlOptions());
        }
        sent += 1;
      } catch (error) {
        // 403 и прочие отказы Telegram: неудачный callApi уже пишет воронка
        // исходящих, алерт админам на каждого заблокировавшего не нужен.
        this.logger.warn(`ИИ-сводка не доставлена ${telegramUserId}: ${String(error)}`);
      }
    }
    await log(DIGEST_LOG.sent(sent, targets.length));
    this.logger.log(`ИИ-сводка ${telegramUserId}: отправлено ${sent} из ${targets.length}`);
    return { sent };
  }

  private isAdmin(telegramUserId: string): boolean {
    return this.config.telegramAdminIds.map(String).includes(telegramUserId);
  }

  private async featuresOf(telegramUserId: string, manual: boolean): Promise<TFeatureMap | null> {
    const features = await this.scheduler.featuresFor(telegramUserId);
    if (features) return features;
    return manual && this.isAdmin(telegramUserId) ? allFeaturesEnabled() : null;
  }

  private adminTargets(
    telegramUserId: string,
    manual: boolean,
  ): { botId: string; chatId: string }[] {
    const bot = this.registry.first();
    if (!manual || !bot || !this.isAdmin(telegramUserId)) return [];
    return [{ botId: String(bot.telegramId), chatId: telegramUserId }];
  }

  @OnQueueFailed()
  onFailed(job: Job<IWeeklyDigestJob>, error: Error): void {
    void this.errors.report({
      error,
      source: 'queue',
      context: 'ai-weekly-digest',
      telegramUserId: job.data?.telegramUserId,
      action: job.data && 'manual' in job.data ? 'сводка по кнопке' : 'по расписанию',
    });
  }
}
