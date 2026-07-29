import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { JOB_TYPES, QUEUE_NAMES } from '../../index';
import type { IScheduledReportJob } from '../services/report-scheduler.service';
import { BotRegistry } from '../../bots/bot-registry.service';
import { UserAccessService } from '../../../../database/services/user-access.service';
import { YandexMarketService } from '../../../../database/services/yandex-market.service';
import { OrderReportsService } from '../../../yandex/reports/order-reports.service';
import { formatReport } from '../../../yandex/reports/report-message';
import { REPORT, type TReportKey } from '../../../yandex/reports/report-status-map';
import { htmlOptions } from '../../formatting/telegram-format';

/**
 * Отправка отчёта по расписанию.
 *
 * Отчёт строится тем же сервисом и форматируется тем же хелпером, что и по
 * кнопке: расхождение между «по кнопке» и «по расписанию» — классический
 * источник жалоб вида «в рассылке одно, а в боте другое».
 */
@Processor(QUEUE_NAMES.REPORTS)
export class ReportsProcessor {
  private readonly logger = new Logger(ReportsProcessor.name);

  constructor(
    private readonly registry: BotRegistry,
    private readonly access: UserAccessService,
    private readonly yandexMarketService: YandexMarketService,
    private readonly reports: OrderReportsService,
  ) {}

  @Process(JOB_TYPES.SEND_SCHEDULED_REPORT)
  async send(job: Job<IScheduledReportJob>): Promise<void> {
    const { telegramUserId, botId, reportKey } = job.data;

    try {
      const bot = this.registry.findByTelegramId(botId);
      if (!bot) {
        this.logger.error(`Бот ${botId} не зарегистрирован — рассылка пропущена`);
        return;
      }

      // Доступ мог быть отозван уже после включения рассылки: продолжать слать
      // отчёты отклонённому пользователю нельзя.
      const account = await this.access.findByUserAndBot(telegramUserId, botId);
      if (!account || account.status !== 'approved') {
        this.logger.warn(`Рассылка для ${telegramUserId} пропущена: доступа нет`);
        return;
      }

      const store = await this.yandexMarketService.findByTelegramUser(telegramUserId);
      if (!store) {
        this.logger.warn(`Рассылка для ${telegramUserId} пропущена: нет настроек API`);
        return;
      }

      const key = reportKey as TReportKey;

      if (key === REPORT.IN_TRANSIT) {
        const exported = await this.reports.exportInTransit(store);
        if (exported.empty) {
          await bot.telegraf.telegram.sendMessage(
            account.telegramChatId,
            exported.message,
            htmlOptions(),
          );
          return;
        }
        await bot.telegraf.telegram.sendDocument(
          account.telegramChatId,
          { source: exported.buffer, filename: exported.filename },
          htmlOptions({ caption: exported.caption }),
        );
        return;
      }

      const result = await this.reports.build(store, key);
      await bot.telegraf.telegram.sendMessage(
        account.telegramChatId,
        formatReport(result),
        htmlOptions(),
      );
    } catch (error) {
      // Ошибку ЛОГИРУЕМ и гасим. Пробрасывать её нельзя: у задачи attempts=1,
      // но даже единственный повтор упавшего отчёта жжёт часовую квоту
      // Partner API, а следующий запуск всё равно через сутки.
      this.logger.error(
        `Не удалось отправить отчёт ${reportKey} пользователю ${telegramUserId}`,
        error as Error,
      );
    }
  }
}
