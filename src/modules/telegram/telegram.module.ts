import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
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
import { MenuCommandsHandler } from './bots/price-changer-bot/handlers/menu-commands.handler';
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
import { StorePromptService } from './bots/shared/services/store-prompt.service';
import { FileProcessingProcessor } from './queue/processors/file-processing.processor';
import { NotificationsProcessor } from './queue/processors/notifications.processor';
import { ReportsProcessor } from './queue/processors/reports.processor';
import { StockSyncProcessor } from './queue/processors/stock-sync.processor';
import { YandexApiProcessor } from './queue/processors/yandex-api.processor';
import { FileProcessingService } from './queue/services/file-processing.service';
import { ReportSchedulerService } from './queue/services/report-scheduler.service';
import { FileDataProcessorService } from './services/file-data-processor.service';
import { TelegramApiService } from './services/telegram.api.service';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';

import { QUEUE_NAMES } from './index';

@Module({
  imports: [
    DatabaseModule,
    YandexModule,
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
    ErrorAlertBridge,
    PriceChangerComposer,
    PriceChangerKeyboard,
    AdminNotifierService,
    StorePromptService,
    AccessGateHandler,
    FeatureGateHandler,
    ActionLogHandler,
    AdminApprovalHandler,
    AdminUsersHandler,
    ReportsHandler,
    ScheduleHandler,
    WarehousesHandler,
    FbyHandler,
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
    FileProcessingProcessor,
    YandexApiProcessor,
    NotificationsProcessor,
    ReportsProcessor,
    StockSyncProcessor,
    ReportSchedulerService,
  ],
  // PriceChangerKeyboard наружу — веб-панель, открывая доступ, шлёт продавцу
  // то же сообщение с тем же меню, что и кнопка «Одобрить» в Telegram.
  // BullModule наружу — QueuesModule читает ТЕ ЖЕ инстансы очередей, что
  // крутят процессоры здесь; свой registerQueue означал бы вторые соединения
  // с Redis и второе место, где могут разъехаться опции очередей.
  exports: [TelegramService, FileProcessingService, BotRegistry, PriceChangerKeyboard, BullModule],
})
export class TelegramModule {}
