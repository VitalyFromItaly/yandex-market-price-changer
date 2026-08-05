import type { IReportPeriod } from '../../../yandex/reports/report-period';

import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

import { YandexMarketService } from '../../../../database/services/yandex-market.service';
import { ErrorReporter } from '../../../errors/error-reporter.service';
import { ProfitService } from '../../../yandex/reports/profit.service';
import { reportErrorText } from '../../../yandex/reports/report-message';
import { formatTariffCalcReport } from '../../../yandex/reports/tariff-calc-message';
import { BotRegistry } from '../../bots/bot-registry.service';
import { htmlOptions } from '../../formatting/telegram-format';
import { JOB_TYPES, QUEUE_NAMES } from '../../index';

/**
 * Полезная нагрузка джобы «Калькулятор». Форма — как у IProfitReportJob: без
 * токена (креды перечитываются из Mongo) и с plain-объектом периода.
 *
 * Флага фичи здесь НЕТ, в отличие от прибыли: там он выбирает, печатать ли
 * строку внутри чужого отчёта, а здесь фича решает, доступен ли экран вообще,
 * и это уже проверено гейтом и хендлером до постановки в очередь.
 */
export interface ITariffReportJob {
  /** Числовой id бота (`ctx.botInfo.id`) — ключ BotRegistry.findByTelegramId. */
  botId: number;
  /** `ctx.chat.id` — единственное, куда можно слать сообщения. */
  chatId: string;
  telegramUserId: string;
  period: IReportPeriod;
}

/**
 * Сборка экрана «🧮 Калькулятор» в фоне — вне цикла апдейтов telegraf.
 *
 * Причина та же, что у profit-report: заказы периода оконными запросами по 30
 * дней, затем каталог (offer-mappings) и сам калькулятор тарифов. На месяце
 * живого магазина это десятки секунд, а polling-цикл telegraf не забирает
 * новые апдейты, пока не завершены текущие, — бот молчал бы для всех.
 *
 * Очередь reports, attempts: 1 — повтор упавшего отчёта жжёт часовую квоту
 * Partner API. @OnQueueFailed не объявлен: он уже есть у ReportsProcessor на
 * этой очереди.
 */
@Processor(QUEUE_NAMES.REPORTS)
export class TariffReportProcessor {
  private readonly logger = new Logger(TariffReportProcessor.name);

  constructor(
    private readonly registry: BotRegistry,
    private readonly yandexMarketService: YandexMarketService,
    private readonly profit: ProfitService,
    private readonly errors: ErrorReporter,
  ) {}

  @Process(JOB_TYPES.SEND_TARIFF_REPORT)
  async run(job: Job<ITariffReportJob>): Promise<void> {
    const { botId, chatId, telegramUserId, period } = job.data;

    const bot = this.registry.findByTelegramId(botId);
    if (!bot) {
      this.logger.error(`Бот ${botId} не зарегистрирован — «Калькулятор» не собран`);
      return;
    }

    try {
      // Креды перечитываются на каждый запуск: магазин могли сменить, пока
      // джоба ждала в очереди.
      const store = await this.yandexMarketService.findByTelegramUser(telegramUserId);
      if (!store) {
        await bot.telegraf.telegram.sendMessage(
          chatId,
          '⚠️ Настройки магазина не найдены — отчёт не собран. Откройте «⚙️ Настройки» и подключите магазин.',
          htmlOptions(),
        );
        return;
      }

      const result = await this.profit.buildTariffReport(store, period);
      await bot.telegraf.telegram.sendMessage(
        chatId,
        formatTariffCalcReport(result),
        htmlOptions(),
      );
    } catch (error) {
      // Ошибку гасим, НЕ пробрасываем (attempts: 1) — но продавец ждёт отчёт,
      // молчать нельзя. Экран калькулятора об ошибке ГОВОРИТ, в отличие от
      // строки-сверки внутри «Прибыли», которая при сбое просто исчезает.
      void this.errors.report({
        error,
        source: 'queue',
        context: 'tariff-report',
        telegramUserId,
        chatId,
        botId: String(botId),
        action: 'экран «Калькулятор»',
      });

      try {
        await bot.telegraf.telegram.sendMessage(chatId, reportErrorText(error), htmlOptions());
      } catch {
        // Не смогли ответить (типовое — 403): сбой сборки уже в журнале,
        // запись о неудачной отправке придёт из callApi.
      }
    }
  }
}
