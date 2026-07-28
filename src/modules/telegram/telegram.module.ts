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
    FileProcessingService,
    FileDataProcessorService,
    FileProcessingProcessor,
    YandexApiProcessor,
    NotificationsProcessor,
  ],
  exports: [TelegramService, FileProcessingService],
})
export class TelegramModule {}
