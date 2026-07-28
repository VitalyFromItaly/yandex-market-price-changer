import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { DatabaseModule } from '../../database/database.module';
import { FileProcessingService } from './queue/services/file-processing.service';
import { FileDataProcessorService } from './services/file-data-processor.service';
import { FileProcessingProcessor } from './queue/processors/file-processing.processor';
import { YandexApiProcessor } from './queue/processors/yandex-api.processor';
import { NotificationsProcessor } from './queue/processors/notifications.processor';
import { QUEUE_NAMES } from './index';
import { BotRegistry } from './bots/bot-registry.service';
import { PriceChangerComposer } from './bots/price-changer-bot/price-changer.composer';
import { PriceChangerKeyboard } from './bots/price-changer-bot/price-changer.keyboard';
import { AdminNotifierService } from './bots/shared/services/admin-notifier.service';
import { AccessGateHandler } from './bots/price-changer-bot/handlers/access-gate.handler';
import { AdminApprovalHandler } from './bots/price-changer-bot/handlers/admin-approval.handler';
import { StartHandler } from './bots/price-changer-bot/handlers/start.handler';
import { MenuCommandsHandler } from './bots/price-changer-bot/handlers/menu-commands.handler';
import { SlashCommandsHandler } from './bots/price-changer-bot/handlers/slash-commands.handler';
import { CallbackQueryHandler } from './bots/price-changer-bot/handlers/callback-query.handler';
import { ApiSettingsHandler } from './bots/price-changer-bot/handlers/api-settings.handler';
import { SharedCommandsHandler } from './bots/price-changer-bot/handlers/shared-commands.handler';
import { FallbackHandler } from './bots/price-changer-bot/handlers/fallback.handler';

@Module({
  imports: [
    DatabaseModule,
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
    PriceChangerComposer,
    PriceChangerKeyboard,
    AdminNotifierService,
    AccessGateHandler,
    AdminApprovalHandler,
    StartHandler,
    MenuCommandsHandler,
    SlashCommandsHandler,
    CallbackQueryHandler,
    ApiSettingsHandler,
    SharedCommandsHandler,
    FallbackHandler,
    FileProcessingService,
    FileDataProcessorService,
    FileProcessingProcessor,
    YandexApiProcessor,
    NotificationsProcessor,
  ],
  exports: [TelegramService, FileProcessingService, BotRegistry],
})
export class TelegramModule {}
