import type { IScheduledReportJob } from '../services/report-scheduler.service';

import { OnQueueError, OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

import { ReportScheduleService } from '../../../../database/services/report-schedule.service';
import { UserAccessService } from '../../../../database/services/user-access.service';
import { YandexMarketService } from '../../../../database/services/yandex-market.service';
import { ErrorReporter } from '../../../errors/error-reporter.service';
import { OrderReportsService } from '../../../yandex/reports/order-reports.service';
import { formatProfitReport } from '../../../yandex/reports/profit-message';
import { formatTariffCalcReport } from '../../../yandex/reports/tariff-calc-message';
import { ProfitService } from '../../../yandex/reports/profit.service';
import { formatReport } from '../../../yandex/reports/report-message';
import { schedulePeriod, type IReportPeriod } from '../../../yandex/reports/report-period';
import { REPORT, type TReportKey } from '../../../yandex/reports/report-status-map';
import { BotRegistry } from '../../bots/bot-registry.service';
import { FEATURE, isFeatureEnabled, isReportEnabled } from '../../bots/shared/features.domain';
import { htmlOptions } from '../../formatting/telegram-format';
import { JOB_TYPES, QUEUE_NAMES } from '../../index';

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
    private readonly profit: ProfitService,
    private readonly schedules: ReportScheduleService,
    private readonly errors: ErrorReporter,
  ) {}

  /**
   * Джоба упала насмерть.
   *
   * send() гасит свои ошибки сам, поэтому сюда попадает то, что случилось
   * ВОКРУГ обработчика: битая полезная нагрузка, отвалившийся Redis в момент
   * фиксации результата. Раньше такое было видно только как запись в failed-set
   * Redis, куда никто не смотрит.
   */
  @OnQueueFailed()
  onFailed(job: Job<IScheduledReportJob>, error: Error): void {
    void this.errors.report({
      error,
      source: 'queue',
      context: 'queue:reports',
      telegramUserId: job?.data?.telegramUserId,
      action: `джоба ${job?.name ?? '?'} #${job?.id ?? '?'}`,
    });
  }

  /**
   * Ошибка самой очереди — почти всегда недоступный Redis.
   *
   * Алерт выключен намеренно: при обрыве связи это событие повторяется на
   * каждой попытке переподключения, а отправка алерта сама идёт через сеть.
   * В журнале запись есть, и этого достаточно.
   */
  @OnQueueError()
  onQueueError(error: Error): void {
    void this.errors.report({
      error,
      source: 'queue',
      context: 'queue:redis',
      alert: false,
    });
  }

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

      // Возможность могли закрыть уже ПОСЛЕ включения рассылки. Расписание при
      // этом остаётся в Redis, и без этой проверки закрытый отчёт продолжал бы
      // приходить каждый день — расхождение между кнопкой и рассылкой здесь
      // самый известный источник жалоб.
      if (
        !isFeatureEnabled(account.features, FEATURE.SCHEDULE) ||
        !isReportEnabled(account.features, reportKey)
      ) {
        this.logger.warn(`Рассылка ${reportKey} для ${telegramUserId} пропущена: закрыта админом`);
        return;
      }

      const store = await this.yandexMarketService.findByTelegramUser(telegramUserId);
      if (!store) {
        this.logger.warn(`Рассылка для ${telegramUserId} пропущена: нет настроек API`);
        return;
      }

      const key = reportKey as TReportKey;

      // Период — тот, что продавец выбрал в настройках рассылки. Неизвестное
      // значение (документ старше поля, правка руками) схлопывается в
      // «сегодня»: рассылка не должна падать из-за строки в базе. Читается ДО
      // ветки выгрузок: «едет до клиента» период игнорирует, но «едет обратно»
      // он нужен уже там.
      const saved = await this.schedules.findOne({ telegramUserId, botId, reportKey });
      const period: IReportPeriod = { key: schedulePeriod(saved?.period) };

      // Две выгрузки уходят файлом, ровно как по кнопке: пустая — текстом.
      if (key === REPORT.IN_TRANSIT || key === REPORT.RETURNING) {
        const exported =
          key === REPORT.IN_TRANSIT
            ? await this.reports.exportInTransit(store)
            : await this.reports.exportReturning(store, period);
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

      // Экран калькулятора — своим сервисом и своим текстом, ровно как по
      // кнопке. isReportEnabled выше уже проверил фичу tariff_calc: ключ
      // отчёта совпадает с ключом фичи, как у остальных пяти.
      if (key === REPORT.TARIFF_CALC) {
        const calc = await this.profit.buildTariffReport(store, period);
        await bot.telegraf.telegram.sendMessage(
          account.telegramChatId,
          formatTariffCalcReport(calc),
          htmlOptions(),
        );
        return;
      }

      // Прибыль — своим сервисом и своим текстом, ровно как по кнопке: и флаг
      // калькулятора проверяется так же, иначе кнопка и рассылка разойдутся —
      // тот самый известный источник жалоб. Запись доступа здесь есть всегда
      // (проверена выше), фолбэк «нет записи = админ» не нужен.
      const text =
        key === REPORT.PROFIT
          ? formatProfitReport(
              await this.profit.build(store, period, new Date(), {
                tariffEstimate: isFeatureEnabled(account.features, FEATURE.TARIFF_CALC),
              }),
            )
          : formatReport(await this.reports.build(store, key, new Date(), period));

      await bot.telegraf.telegram.sendMessage(account.telegramChatId, text, htmlOptions());
    } catch (error) {
      // Ошибку ЛОГИРУЕМ и гасим. Пробрасывать её нельзя: у задачи attempts=1,
      // но даже единственный повтор упавшего отчёта жжёт часовую квоту
      // Partner API, а следующий запуск всё равно через сутки.
      //
      // Гасим — но не молча: пользователь не получит отчёт и не узнает почему,
      // поэтому единственный, кто может заметить поломку, это администратор.
      void this.errors.report({
        error,
        source: 'queue',
        context: `digest:${reportKey}`,
        telegramUserId,
        action: `рассылка отчёта ${reportKey}`,
      });
    }
  }
}
