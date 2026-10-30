import { BullModule } from '@nestjs/bull';
import { Module, forwardRef } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { PostgresModule } from '../../database/postgres/postgres.module';
import { AiAnalystModule } from '../ai-analyst/ai-analyst.module';
import { FinanceModule } from '../finance/finance.module';
import { HealthModule } from '../health/health.module';
import { MarketplacesModule } from '../marketplaces/marketplaces.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PriceSetModule } from '../price-set/price-set.module';
import { StockPushModule } from '../stock-push/stock-push.module';
import { YandexModule } from '../yandex/yandex.module';

import { BotRegistry } from './bots/bot-registry.service';
import { ErrorAlertBridge } from './bots/error-alert.bridge';
import { AccessGateHandler } from './bots/price-changer-bot/handlers/access-gate.handler';
import { ActionLogHandler } from './bots/price-changer-bot/handlers/action-log.handler';
import { AdminApprovalHandler } from './bots/price-changer-bot/handlers/admin-approval.handler';
import { AdminUsersHandler } from './bots/price-changer-bot/handlers/admin-users.handler';
import { ApiSettingsHandler } from './bots/price-changer-bot/handlers/api-settings.handler';
import { CallbackQueryHandler } from './bots/price-changer-bot/handlers/callback-query.handler';
import { FallbackHandler } from './bots/price-changer-bot/handlers/fallback.handler';
import { FbyHandler } from './bots/price-changer-bot/handlers/fby.handler';
import { FeatureGateHandler } from './bots/price-changer-bot/handlers/feature-gate.handler';
import { FeedbackHandler } from './bots/price-changer-bot/handlers/feedback.handler';
import { HealthCommandHandler } from './bots/price-changer-bot/handlers/health-command.handler';
import { MarketReportsHandler } from './bots/price-changer-bot/handlers/market-reports.handler';
import { MenuCommandsHandler } from './bots/price-changer-bot/handlers/menu-commands.handler';
import { OfferCardsHandler } from './bots/price-changer-bot/handlers/offer-cards.handler';
import { PaymentsHandler } from './bots/price-changer-bot/handlers/payments.handler';
import { PriceRecommendationsHandler } from './bots/price-changer-bot/handlers/price-recommendations.handler';
import { QuarantineHandler } from './bots/price-changer-bot/handlers/quarantine.handler';
import { ReportsHandler } from './bots/price-changer-bot/handlers/reports.handler';
import { ScheduleHandler } from './bots/price-changer-bot/handlers/schedule.handler';
import { SharedCommandsHandler } from './bots/price-changer-bot/handlers/shared-commands.handler';
import { SlashCommandsHandler } from './bots/price-changer-bot/handlers/slash-commands.handler';
import { StartHandler } from './bots/price-changer-bot/handlers/start.handler';
import { StockUploadHandler } from './bots/price-changer-bot/handlers/stock-upload.handler';
import { WarehousesHandler } from './bots/price-changer-bot/handlers/warehouses.handler';
import { PriceChangerComposer } from './bots/price-changer-bot/price-changer.composer';
import { PriceChangerKeyboard } from './bots/price-changer-bot/price-changer.keyboard';
import { AdminNotifierService } from './bots/shared/services/admin-notifier.service';
import { BotCommandsService } from './bots/shared/services/bot-commands.service';
import { StorePromptService } from './bots/shared/services/store-prompt.service';
import { TelegramApiMetrics } from './bots/telegram-api-metrics.service';
import { FbyOverviewProcessor } from './queue/processors/fby-overview.processor';
import { FeedbackDraftProcessor } from './queue/processors/feedback-draft.processor';
import { FinanceImportProcessor } from './queue/processors/finance-import.processor';
import { HostingReminderProcessor } from './queue/processors/hosting-reminder.processor';
import { MarketReportProcessor } from './queue/processors/market-report.processor';
import { NotificationsProcessor } from './queue/processors/notifications.processor';
import { OfferCardsProcessor } from './queue/processors/offer-cards.processor';
import { PaymentsReportProcessor } from './queue/processors/payments-report.processor';
import { PriceRecommendationsProcessor } from './queue/processors/price-recommendations.processor';
import { ProfitReportProcessor } from './queue/processors/profit-report.processor';
import { ReportsProcessor } from './queue/processors/reports.processor';
import { SellerNotificationsProcessor } from './queue/processors/seller-notifications.processor';
import { StockSyncProcessor } from './queue/processors/stock-sync.processor';
import { TariffReportProcessor } from './queue/processors/tariff-report.processor';
import { WarehousesOverviewProcessor } from './queue/processors/warehouses-overview.processor';
import { WeeklyDigestProcessor } from './queue/processors/weekly-digest.processor';
import { YandexApiProcessor } from './queue/processors/yandex-api.processor';
import { FileProcessingService } from './queue/services/file-processing.service';
import { FinanceImportScheduler } from './queue/services/finance-import.scheduler';
import { HostingReminderScheduler } from './queue/services/hosting-reminder.scheduler';
import { HostingReminderService } from './queue/services/hosting-reminder.service';
import { ReportSchedulerService } from './queue/services/report-scheduler.service';
import { SellerNotificationsScheduler } from './queue/services/seller-notifications.scheduler';
import { StockPushScheduler } from './queue/services/stock-push.scheduler';
import { WeeklyDigestScheduler } from './queue/services/weekly-digest.scheduler';
import { FileDataProcessorService } from './services/file-data-processor.service';
import { TelegramApiService } from './services/telegram.api.service';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';

import { QUEUE_NAMES } from './index';

@Module({
  imports: [
    DatabaseModule,
    // Кнопка «Загрузить из Маркета» сверяет кулдаун со строкой периода (finance_periods).
    PostgresModule,
    YandexModule,
    FinanceModule,
    NotificationsModule,
    // ИИ-сводка недели (TASK-168): WeeklyDigestService — факты из финансов и AiService.
    AiAnalystModule,
    MarketplacesModule,
    StockPushModule,
    PriceSetModule,
    // Цикл настоящий и обоюдный: HealthModule берёт отсюда очередь reports (ради
    // клиента Redis) и BotRegistry, а команда /health смотрит обратно, в
    // HealthMonitorService. forwardRef с обеих сторон — единственный способ.
    forwardRef(() => HealthModule),
    BullModule.registerQueue(
      {
        name: QUEUE_NAMES.FILE_PROCESSING,
        defaultJobOptions: {
          removeOnComplete: 20,
          removeOnFail: 50,
          attempts: 2,
          backoff: {
            type: 'fixed',
            delay: 1000,
          },
        },
      },
      {
        name: QUEUE_NAMES.YANDEX_API,
        defaultJobOptions: {
          removeOnComplete: 10,
          removeOnFail: 100,
          attempts: 5,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        },
      },
      {
        name: QUEUE_NAMES.REPORTS,
        defaultJobOptions: {
          removeOnComplete: 20,
          removeOnFail: 50,
          // Ровно одна попытка: следующий запуск всё равно через сутки, а
          // повторы упавшего отчёта жгут часовую квоту Partner API.
          attempts: 1,
        },
      },
      {
        name: QUEUE_NAMES.CRM_JOBS,
        defaultJobOptions: {
          removeOnComplete: 20,
          removeOnFail: 50,
          // Одна попытка, довод `reports`: повтор жжёт квоту Partner API, а
          // продавец видит failed и сам нажмёт ещё раз.
          attempts: 1,
        },
      },
      {
        name: QUEUE_NAMES.FINANCE_IMPORT,
        defaultJobOptions: {
          removeOnComplete: 20,
          removeOnFail: 50,
          // Одна попытка: у united-netting квота 100 генераций в час, а
          // расписание (TASK-112) всё равно повторит период в следующий проход.
          attempts: 1,
        },
      },
      {
        name: QUEUE_NAMES.SELLER_NOTIFICATIONS,
        defaultJobOptions: {
          removeOnComplete: 20,
          removeOnFail: 50,
          // Одна попытка: завтра проверка повторится сама, а повтор ходит в API площадок.
          attempts: 1,
        },
      },
      {
        name: QUEUE_NAMES.AI_WEEKLY_DIGEST,
        defaultJobOptions: {
          removeOnComplete: 20,
          removeOnFail: 50,
          // Одна попытка: повтор — второй платный запрос к Polza и, возможно, второе сообщение.
          attempts: 1,
        },
      },
      {
        name: QUEUE_NAMES.NOTIFICATIONS,
        defaultJobOptions: {
          removeOnComplete: 50,
          removeOnFail: 20,
          attempts: 3,
          backoff: {
            type: 'fixed',
            delay: 2000,
          },
        },
      },
    ),
  ],
  controllers: [TelegramController],
  providers: [
    TelegramService,
    // Слой ботов: всё через DI, ручного `new` больше нет.
    BotRegistry,
    TelegramApiMetrics,
    ErrorAlertBridge,
    PriceChangerComposer,
    PriceChangerKeyboard,
    AdminNotifierService,
    BotCommandsService,
    StorePromptService,
    AccessGateHandler,
    FeatureGateHandler,
    ActionLogHandler,
    AdminApprovalHandler,
    AdminUsersHandler,
    HealthCommandHandler,
    ReportsHandler,
    ScheduleHandler,
    WarehousesHandler,
    FbyHandler,
    QuarantineHandler,
    FeedbackHandler,
    PaymentsHandler,
    PriceRecommendationsHandler,
    MarketReportsHandler,
    OfferCardsHandler,
    StartHandler,
    MenuCommandsHandler,
    SlashCommandsHandler,
    CallbackQueryHandler,
    ApiSettingsHandler,
    StockUploadHandler,
    SharedCommandsHandler,
    FallbackHandler,
    FileProcessingService,
    FileDataProcessorService,
    TelegramApiService,
    /**
     * FileProcessingProcessor (мёртвый 4-хоповый конвейер) здесь НАМЕРЕННО нет.
     * Он висел на той же очереди file-processing с тремя `@Process` по
     * concurrency 3, а Bull СУММИРУЕТ конкурентность всех обработчиков одной
     * очереди (queue.js, `while (concurrency--)`): любой из 10 циклов берёт
     * джобу с любым именем. Так две записи остатков — даже одного продавца —
     * шли параллельно, при том что код и CLAUDE.md обещали «строго по одной».
     * Единственный обработчик — SYNC_STOCKS с concurrency 1, и туда же ставит
     * прайс CRM. Пиннится тестом stock-queue-concurrency.test.ts.
     */
    YandexApiProcessor,
    NotificationsProcessor,
    ReportsProcessor,
    StockSyncProcessor,
    FbyOverviewProcessor,
    WarehousesOverviewProcessor,
    ProfitReportProcessor,
    TariffReportProcessor,
    FeedbackDraftProcessor,
    PaymentsReportProcessor,
    PriceRecommendationsProcessor,
    OfferCardsProcessor,
    MarketReportProcessor,
    HostingReminderProcessor,
    FinanceImportProcessor,
    ReportSchedulerService,
    HostingReminderScheduler,
    HostingReminderService,
    FinanceImportScheduler,
    SellerNotificationsProcessor,
    SellerNotificationsScheduler,
    WeeklyDigestProcessor,
    WeeklyDigestScheduler,
    StockPushScheduler,
  ],
  // PriceChangerKeyboard наружу — веб-панель, открывая доступ, шлёт продавцу
  // то же сообщение с тем же меню, что и кнопка «Одобрить» в Telegram.
  // BullModule наружу — QueuesModule читает ТЕ ЖЕ инстансы очередей, что
  // крутят процессоры здесь; свой registerQueue означал бы вторые соединения
  // с Redis и второе место, где могут разъехаться опции очередей.
  exports: [
    TelegramService,
    FileProcessingService,
    BotRegistry,
    PriceChangerKeyboard,
    // Панель доступа открывает и закрывает доступ из веб-интерфейса, а вместе с
    // ним меняется персональный список команд чата.
    BotCommandsService,
    // Панель очередей показывает, кому уйдёт напоминание об оплате, — и обязана
    // спрашивать это у того же сервиса, что и сама рассылка.
    HostingReminderService,
    // Панель очередей показывает расписание загрузки финансов, панель доступа
    // пересверяет его после правки флага — у того же планировщика.
    FinanceImportScheduler,
    // Панель доступа пересверяет расписание уведомлений, CRM ставит проверку по кнопке.
    SellerNotificationsScheduler,
    // Панель доступа пересверяет расписание ИИ-сводки, панель очередей шлёт её по кнопке.
    WeeklyDigestScheduler,
    // Панель доступа пересверяет расписание «Передачи остатков», панель очередей запускает проход.
    StockPushScheduler,
    BullModule,
  ],
})
export class TelegramModule {}
