import type { RegisteredBot } from '../../bots/bot-registry.service';
import type { IReminderRecipient } from '../../bots/price-changer-bot/hosting-reminder';

import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';

import { UserAccessService } from '../../../../database/services/user-access.service';
import { YandexMarketService } from '../../../../database/services/yandex-market.service';
import { ErrorReporter } from '../../../errors/error-reporter.service';
import { isLastDayOfMonth, moscowDay } from '../../../yandex/reports/moscow-day';
import { BotRegistry } from '../../bots/bot-registry.service';
import {
  HOSTING_REMINDER_TEXT,
  pickRecipients,
} from '../../bots/price-changer-bot/hosting-reminder';
import { htmlOptions } from '../../formatting/telegram-format';
import { JOB_TYPES, QUEUE_NAMES } from '../../index';

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
    private readonly access: UserAccessService,
    private readonly yandexMarketService: YandexMarketService,
    private readonly errors: ErrorReporter,
  ) {}

  @Process(JOB_TYPES.SEND_HOSTING_REMINDER)
  async run(): Promise<void> {
    const today = moscowDay(new Date());

    if (!isLastDayOfMonth(today)) {
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

  /** Получатели одного бота и последовательная отправка. */
  private async notifyBotUsers(bot: RegisteredBot): Promise<void> {
    const botId = bot.telegramId.toString();
    const accounts = await this.access.listByBot(botId);

    // Магазины — ОДНИМ запросом по списку id, а не isConfigured на строку
    // (приём AccessController). Токен здесь не нужен: важен сам факт
    // подключения.
    const stores = await this.yandexMarketService.findByTelegramUsers(
      accounts.map((account) => account.telegramUserId),
    );
    const configured = new Set(
      stores
        .filter((store) => store.campaign_id && store.business_id && store.token)
        .map((store) => store.telegramUserId),
    );

    const recipients = pickRecipients(accounts, configured);
    if (!recipients.length) {
      this.logger.log(`Напоминание об оплате: у бота ${botId} получателей нет`);
      return;
    }

    const sent = await this.send(bot, recipients);
    this.logger.log(
      `Напоминание об оплате ботом ${botId}: отправлено ${sent} из ${recipients.length}`,
    );
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
