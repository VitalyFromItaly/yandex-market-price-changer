import type { IReportPeriod } from '../../../yandex/reports/report-period';

import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

import { YandexMarketService } from '../../../../database/services/yandex-market.service';
import { ErrorReporter } from '../../../errors/error-reporter.service';
import { formatProfitReport } from '../../../yandex/reports/profit-message';
import { ProfitService } from '../../../yandex/reports/profit.service';
import { reportErrorText } from '../../../yandex/reports/report-message';
import { BotRegistry } from '../../bots/bot-registry.service';
import { htmlOptions } from '../../formatting/telegram-format';
import { JOB_TYPES, QUEUE_NAMES } from '../../index';

/**
 * Полезная нагрузка джобы «Прибыль». Без токена — креды перечитываются из
 * Mongo, тот же довод, что у IStockSyncJob. Период — plain-объект
 * ({key, day?: {year, month, day}}), JSON-safe по построению.
 */
export interface IProfitReportJob {
  /** Числовой id бота (`ctx.botInfo.id`) — ключ BotRegistry.findByTelegramId. */
  botId: number;
  /** `ctx.chat.id` — единственное, куда можно слать сообщения. */
  chatId: string;
  telegramUserId: string;
  period: IReportPeriod;
  /**
   * Флаг строки калькулятора, вычисленный ХЕНДЛЕРОМ. Не перечитывается здесь:
   * у администратора нет записи UserAccess, и слепая перепроверка по
   * default-off фиче отбила бы ровно его — та же причина, по которой
   * fby-overview.processor не перепроверяет фичу fby.
   */
  tariffEstimate: boolean;
}

/**
 * Сборка «Прибыли» в фоне — вне цикла апдейтов telegraf.
 *
 * Причина та же, что у stock-sync и fby-overview: «Прибыль» — самый дорогой
 * отчёт (два набора заказов оконными запросами по 30 дней, возвраты,
 * калькулятор тарифов), и ожидание в хендлере держало polling-цикл — бот
 * молчал для всех, пока считалась чья-то прибыль.
 *
 * Остальные отчёты остаются в хендлере: они заметно быстрее, а их тестовый
 * слой завязан на синхронный ответ. Переводить их стоит этим же паттерном,
 * когда дойдут руки или жалоба.
 *
 * Очередь reports, attempts: 1 — повтор упавшего отчёта жжёт часовую квоту
 * Partner API. @OnQueueFailed не объявлен: он уже есть у ReportsProcessor на
 * этой очереди.
 */
@Processor(QUEUE_NAMES.REPORTS)
export class ProfitReportProcessor {
  private readonly logger = new Logger(ProfitReportProcessor.name);

  constructor(
    private readonly registry: BotRegistry,
    private readonly yandexMarketService: YandexMarketService,
    private readonly profit: ProfitService,
    private readonly errors: ErrorReporter,
  ) {}

  @Process(JOB_TYPES.SEND_PROFIT_REPORT)
  async run(job: Job<IProfitReportJob>): Promise<void> {
    const { botId, chatId, telegramUserId, period, tariffEstimate } = job.data;

    const bot = this.registry.findByTelegramId(botId);
    if (!bot) {
      this.logger.error(`Бот ${botId} не зарегистрирован — «Прибыль» не собрана`);
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

      const result = await this.profit.build(store, period, new Date(), { tariffEstimate });
      await bot.telegraf.telegram.sendMessage(chatId, formatProfitReport(result), htmlOptions());
    } catch (error) {
      // Ошибку гасим, НЕ пробрасываем (attempts: 1) — но продавец ждёт отчёт,
      // молчать нельзя.
      void this.errors.report({
        error,
        source: 'queue',
        context: 'profit-report',
        telegramUserId,
        chatId,
        botId: String(botId),
        action: 'отчёт «Прибыль»',
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
