import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

import { YandexMarketService } from '../../../../database/services/yandex-market.service';
import { ErrorReporter } from '../../../errors/error-reporter.service';
import { PaymentsReportService } from '../../../yandex/payments/payments-report.service';
import {
  paymentsErrorText,
  paymentsNoDataText,
  paymentsRange,
  type TPaymentsPeriod,
} from '../../../yandex/payments/payments.domain';
import { BotRegistry } from '../../bots/bot-registry.service';
import { htmlOptions } from '../../formatting/telegram-format';
import { JOB_TYPES, QUEUE_NAMES } from '../../index';

/**
 * Полезная нагрузка джобы отчёта по платежам. Без токена — креды
 * перечитываются из Mongo (довод IStockSyncJob). Период едет ключом, а даты
 * считаются В ПРОЦЕССОРЕ: «с 1 числа» на момент отправки, а не постановки.
 */
export interface IPaymentsReportJob {
  botId: number;
  chatId: string;
  telegramUserId: string;
  period: TPaymentsPeriod;
}

/**
 * Сборка отчёта по платежам в фоне — generate→поллинг занимает минуты, и
 * ожидание в хендлере стопорило бы polling-цикл telegraf для всех (довод
 * fby-overview.processor).
 *
 * @OnQueueFailed НЕ объявлен намеренно: он уже есть у ReportsProcessor на
 * этой очереди, второй давал бы двойные записи журнала. Фича повторно не
 * проверяется — джоба живёт секунды после кнопки, которую гейт пропустил, а
 * слепая перепроверка отбивала бы админов.
 */
@Processor(QUEUE_NAMES.REPORTS)
export class PaymentsReportProcessor {
  private readonly logger = new Logger(PaymentsReportProcessor.name);

  constructor(
    private readonly registry: BotRegistry,
    private readonly yandexMarketService: YandexMarketService,
    private readonly payments: PaymentsReportService,
    private readonly errors: ErrorReporter,
  ) {}

  @Process(JOB_TYPES.SEND_PAYMENTS_REPORT)
  async run(job: Job<IPaymentsReportJob>): Promise<void> {
    const { botId, chatId, telegramUserId, period } = job.data;

    const bot = this.registry.findByTelegramId(botId);
    if (!bot) {
      this.logger.error(`Бот ${botId} не зарегистрирован — отчёт по платежам не собран`);
      return;
    }

    try {
      const store = await this.yandexMarketService.findByTelegramUser(telegramUserId);
      if (!store) {
        await bot.telegraf.telegram.sendMessage(
          chatId,
          '⚠️ Настройки магазина не найдены — отчёт не собран. Откройте «⚙️ Настройки» и подключите магазин.',
          htmlOptions(),
        );
        return;
      }

      const range = paymentsRange(period);
      const result = await this.payments.build(store, range);

      if (!result.file) {
        await bot.telegraf.telegram.sendMessage(chatId, paymentsNoDataText(range), htmlOptions());
        return;
      }

      await bot.telegraf.telegram.sendDocument(
        chatId,
        { source: result.file.buffer, filename: result.file.filename },
        { caption: result.file.caption },
      );
    } catch (error) {
      // Ошибку гасим, НЕ пробрасываем (attempts: 1) — но продавец ждёт файл.
      void this.errors.report({
        error,
        source: 'queue',
        context: 'payments-report',
        telegramUserId,
        chatId,
        botId: String(botId),
        action: 'отчёт по платежам',
      });

      try {
        await bot.telegraf.telegram.sendMessage(chatId, paymentsErrorText(), htmlOptions());
      } catch {
        // Не смогли ответить (типовое — 403): сбой уже в журнале.
      }
    }
  }
}
