import type { IReportPeriod } from '../../../yandex/reports/report-period';

import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

import { YandexMarketService } from '../../../../database/services/yandex-market.service';
import { ErrorReporter } from '../../../errors/error-reporter.service';
import { ProfitService } from '../../../yandex/reports/profit.service';
import { reportErrorText } from '../../../yandex/reports/report-message';
import { periodBounds } from '../../../yandex/reports/report-period';
import { topSkusWorkbook } from '../../../yandex/top-skus/top-skus-workbook';
import {
  formatTopSkus,
  topSkusFilename,
  topSkusOf,
} from '../../../yandex/top-skus/top-skus.domain';
import { BotRegistry } from '../../bots/bot-registry.service';
import { htmlOptions } from '../../formatting/telegram-format';
import { JOB_TYPES, QUEUE_NAMES } from '../../index';

/**
 * Полезная нагрузка «🏆 Топа товаров». Без токена — креды перечитываются из Mongo
 * (довод IProfitReportJob). Флаги решает хендлер: у админа нет записи UserAccess.
 */
export interface ITopSkusReportJob {
  botId: number;
  chatId: string;
  telegramUserId: string;
  period: IReportPeriod;
  deepHistory?: boolean;
  /** Разрезы по регионам и кластерам (сейчас всегда включены). */
  places?: boolean;
}

/**
 * Сборка «Топа товаров» в фоне — тот же `ProfitService.build`, что «Прибыль», и та же
 * причина очереди: два набора заказов оконными запросами держали бы polling-цикл.
 * Очередь reports, attempts: 1; @OnQueueFailed — только у ReportsProcessor.
 */
@Processor(QUEUE_NAMES.REPORTS)
export class TopSkusReportProcessor {
  private readonly logger = new Logger(TopSkusReportProcessor.name);

  constructor(
    private readonly registry: BotRegistry,
    private readonly yandexMarketService: YandexMarketService,
    private readonly profit: ProfitService,
    private readonly errors: ErrorReporter,
  ) {}

  @Process(JOB_TYPES.SEND_TOP_SKUS_REPORT)
  async run(job: Job<ITopSkusReportJob>): Promise<void> {
    const { botId, chatId, telegramUserId, period, deepHistory, places } = job.data;

    const bot = this.registry.findByTelegramId(botId);
    if (!bot) {
      this.logger.error(`Бот ${botId} не зарегистрирован — «Топ товаров» не собран`);
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

      const now = new Date();
      const report = await this.profit.build(store, period, now, {
        deepHistory: deepHistory ?? false,
        places: places ?? false,
      });
      const view = topSkusOf(report);

      await bot.telegraf.telegram.sendMessage(chatId, formatTopSkus(view, now), htmlOptions());
      if (view.skus.some((row) => row.count > 0)) {
        await bot.telegraf.telegram.sendDocument(chatId, {
          source: topSkusWorkbook(view),
          filename: topSkusFilename(periodBounds(view.period, now)),
        });
      }
    } catch (error) {
      void this.errors.report({
        error,
        source: 'queue',
        context: 'top-skus-report',
        telegramUserId,
        chatId,
        botId: String(botId),
        action: 'отчёт «Топ товаров»',
      });
      try {
        await bot.telegraf.telegram.sendMessage(chatId, reportErrorText(error), htmlOptions());
      } catch {
        // Не смогли ответить (типовое — 403): сбой уже в журнале.
      }
    }
  }
}
