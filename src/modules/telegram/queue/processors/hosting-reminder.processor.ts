import type { RegisteredBot } from '../../bots/bot-registry.service';
import type { IReminderRecipient } from '../../bots/price-changer-bot/hosting-reminder';

import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

import { ActionLogService } from '../../../../database/services/action-log.service';
import { ErrorReporter } from '../../../errors/error-reporter.service';
import { isLastDayOfMonth, moscowDay } from '../../../yandex/reports/moscow-day';
import { BotRegistry } from '../../bots/bot-registry.service';
import { HOSTING_REMINDER_TEXT } from '../../bots/price-changer-bot/hosting-reminder';
import { htmlOptions } from '../../formatting/telegram-format';
import { JOB_TYPES, QUEUE_NAMES } from '../../index';
import { HostingReminderService } from '../services/hosting-reminder.service';

/**
 * Полезная нагрузка рассылки.
 *
 * `force` ставит только кнопка панели: она обходит проверку «сегодня последний
 * день месяца» и НИЧЕГО больше — отбор получателей остаётся тем же. Флаг в
 * payload, а не второй тип джобы: делает она ровно то же самое, а второй тип
 * означал бы второй `@Process` с той же логикой.
 */
export interface IHostingReminderJob {
  force?: boolean;
}

/**
 * `kind` строки журнала о самой рассылке (не о её сообщениях).
 *
 * Прецедент — `kind: 'health'` у самопроверки: это не ошибка и не действие
 * пользователя, но событие, которое обязано быть видно в панели.
 */
export const HOSTING_REMINDER_LOG_KIND = 'hosting-reminder';

/**
 * Пауза между сообщениями.
 *
 * У Telegram около 30 сообщений в секунду на бота; рассылка — единственное
 * место, где бот шлёт подряд десяткам людей, и упереться в 429 здесь проще
 * всего. 100 мс — десять в секунду: с запасом, и на любом мыслимом числе
 * продавцов рассылка укладывается в минуты.
 */
const SEND_DELAY_MS = 100;

/**
 * Напоминание об оплате хостинга — единственная рассылка «всем сразу».
 *
 * Джоба повторяемая и будит нас 28–31 числа: **cron не выражает «последний день
 * месяца»**, поэтому день проверяется здесь, чистой `isLastDayOfMonth`. Три
 * запуска из четырёх штатно заканчиваются ничем — это норма, а не сбой, и в лог
 * они идут через `debug`.
 *
 * Обходим ВСЕХ ботов реестра, а не `first()`: при двух арендаторах напоминание
 * молча ушло бы продавцам одного из них.
 *
 * @OnQueueFailed здесь НЕ объявлен намеренно: он уже есть у ReportsProcessor на
 * этой же очереди, второй обработчик дал бы двойные записи в журнале.
 */
@Processor(QUEUE_NAMES.REPORTS)
export class HostingReminderProcessor {
  private readonly logger = new Logger(HostingReminderProcessor.name);

  constructor(
    private readonly registry: BotRegistry,
    private readonly recipients: HostingReminderService,
    private readonly actionLog: ActionLogService,
    private readonly errors: ErrorReporter,
  ) {}

  @Process(JOB_TYPES.SEND_HOSTING_REMINDER)
  async run(job: Job<IHostingReminderJob>): Promise<void> {
    const today = moscowDay(new Date());
    const forced = job?.data?.force === true;

    if (!forced && !isLastDayOfMonth(today)) {
      this.logger.debug(`Не последний день месяца (${today.day}.${today.month}) — рассылки нет`);
      return;
    }

    for (const bot of this.registry.all()) {
      try {
        await this.notifyBotUsers(bot);
      } catch (error) {
        // Падение на одном боте не должно лишать напоминания продавцов
        // остальных: у каждого арендатора свой список получателей.
        void this.errors.report({
          error: error as Error,
          source: 'queue',
          context: 'hosting-reminder',
          action: `рассылка напоминания ботом ${bot.telegramId}`,
        });
      }
    }
  }

  /**
   * Получатели одного бота и последовательная отправка.
   *
   * Список берётся у `HostingReminderService` — того же, что отвечает панели на
   * вопрос «кому уйдёт». Считать его здесь заново значило бы завести вторую
   * копию правила, которая разошлась бы с показанной админу молча.
   */
  private async notifyBotUsers(bot: RegisteredBot): Promise<void> {
    const botId = bot.telegramId.toString();
    const recipients = await this.recipients.recipientsFor(botId);

    if (!recipients.length) {
      this.logger.log(`Напоминание об оплате: у бота ${botId} получателей нет`);
      // Строку журнала пишем и здесь: «получателей не было» — это ответ на
      // вопрос «почему никому не пришло», а молчание таким ответом не является.
      await this.journal(botId, 'получателей нет');
      return;
    }

    const sent = await this.send(bot, recipients);
    const summary = `отправлено ${sent} из ${recipients.length}`;

    this.logger.log(`Напоминание об оплате ботом ${botId}: ${summary}`);
    await this.journal(botId, summary);
  }

  /**
   * Одна строка в журнал о самой рассылке.
   *
   * Исходящие сообщения журналируются сами (воронка `callApi`) и отвечают на
   * вопрос «кому ушло». Эта строка отвечает на другой — «рассылка вообще
   * состоялась?», и именно её читает карточка в панели как «последняя
   * отправка». Без неё отличить «сегодня не тот день» от «задача не заведена»
   * можно было только по логам контейнера, которые не переживают рестарт.
   *
   * `record` не бросает сам, но и ждать его нечего — журнал не имеет права
   * помешать рассылке (та же политика, что у ActionLogHandler).
   */
  private async journal(botId: string, summary: string): Promise<void> {
    await this.actionLog.record({
      // «system» — тот же псевдопользователь, под которым ErrorReporter пишет
      // сбои HTTP и процесса: рассылка не принадлежит ни одному продавцу.
      telegramUserId: 'system',
      botId,
      direction: 'out',
      kind: HOSTING_REMINDER_LOG_KIND,
      action: `напоминание об оплате хостинга: ${summary}`,
    });
  }

  /**
   * Отправка по одному.
   *
   * Ошибка на получателе НЕ останавливает остальных: типовая причина — 403,
   * пользователь заблокировал бота, и это не сбой рассылки (довод
   * `AccessNotifierService`). В журнал ошибок такое не сообщаем: неудачный
   * `callApi` уже пишется воронкой исходящих, а алерт админам на каждого
   * заблокировавшего сделал бы оповещения нечитаемыми.
   */
  private async send(bot: RegisteredBot, recipients: IReminderRecipient[]): Promise<number> {
    let sent = 0;

    for (const [index, recipient] of recipients.entries()) {
      try {
        await bot.telegraf.telegram.sendMessage(
          recipient.telegramChatId,
          HOSTING_REMINDER_TEXT,
          htmlOptions(),
        );
        sent += 1;
      } catch (error) {
        this.logger.warn(`Напоминание не доставлено ${recipient.telegramUserId}: ${String(error)}`);
      }

      if (index < recipients.length - 1) await this.pause();
    }

    return sent;
  }

  private async pause(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SEND_DELAY_MS));
  }
}
