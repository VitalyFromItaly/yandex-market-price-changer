import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

import { YandexMarketService } from '../../../../database/services/yandex-market.service';
import { ErrorReporter } from '../../../errors/error-reporter.service';
import {
  MARKET_REPORT_META,
  mktErrorText,
  mktNoDataText,
  mktRateLimitText,
  type TMarketReportKey,
} from '../../../yandex/market-reports/market-reports.domain';
import {
  MarketReportsService,
  type IMarketReportParams,
} from '../../../yandex/market-reports/market-reports.service';
import { YandexRateLimitError } from '../../../yandex/yandex-api.errors';
import { BotRegistry } from '../../bots/bot-registry.service';
import { htmlOptions } from '../../formatting/telegram-format';
import { JOB_TYPES, QUEUE_NAMES } from '../../index';

/**
 * Полезная нагрузка джобы отчёта Маркета. Без токена — креды из Mongo. Даты
 * в payload НЕ едут: период задан ключом и считается в процессоре на момент
 * отправки (довод платежей).
 */
export interface IMarketReportJob {
  botId: number;
  chatId: string;
  telegramUserId: string;
  report: TMarketReportKey;
  params: IMarketReportParams;
}

/**
 * Сборка отчёта Маркета в фоне — generate→поллинг занимает минуты (довод
 * payments-report.processor).
 *
 * @OnQueueFailed НЕ объявлен — он уже есть у ReportsProcessor на этой очереди.
 * Фича не перепроверяется — джоба живёт секунды после кнопки, пропущенной
 * гейтом, а слепая перепроверка отбивала бы админов.
 */
@Processor(QUEUE_NAMES.REPORTS)
export class MarketReportProcessor {
  private readonly logger = new Logger(MarketReportProcessor.name);

  constructor(
    private readonly registry: BotRegistry,
    private readonly yandexMarketService: YandexMarketService,
    private readonly marketReports: MarketReportsService,
    private readonly errors: ErrorReporter,
  ) {}

  @Process(JOB_TYPES.SEND_MARKET_REPORT)
  async run(job: Job<IMarketReportJob>): Promise<void> {
    const { botId, chatId, telegramUserId, report, params } = job.data;

    const bot = this.registry.findByTelegramId(botId);
    if (!bot) {
      this.logger.error(`Бот ${botId} не зарегистрирован — отчёт Маркета не собран`);
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

      const result = await this.marketReports.build(store, report, params);

      if (!result.file) {
        await bot.telegraf.telegram.sendMessage(chatId, mktNoDataText(report), htmlOptions());
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
        context: `market-report:${report}`,
        telegramUserId,
        chatId,
        botId: String(botId),
        action: `отчёт Маркета «${MARKET_REPORT_META[report]?.title ?? report}»`,
      });

      // 420 у отчётов с квотой 10/час — «подождите», а не поломка.
      const text =
        error instanceof YandexRateLimitError && MARKET_REPORT_META[report]?.hourlyLimit
          ? mktRateLimitText(report)
          : mktErrorText(report);

      try {
        await bot.telegraf.telegram.sendMessage(chatId, text, htmlOptions());
      } catch {
        // Не смогли ответить (типовое — 403): сбой уже в журнале.
      }
    }
  }
}
