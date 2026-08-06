import { Module, forwardRef } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { TelegramModule } from '../telegram/telegram.module';

import { HealthMonitorService } from './health-monitor.service';

/**
 * Самопроверка окружения.
 *
 * DatabaseModule — ради реэкспорта MongooseModule (само соединение через
 * @InjectConnection, а не какая-то модель) и ради ActionLogService: возврат в
 * норму пишется в журнал, а ошибкой не является, поэтому идёт мимо ErrorReporter.
 *
 * TelegramModule — ради двух вещей: реэкспорта BullModule (очередь reports нужна
 * только чтобы дотянуться до её клиента ioredis и пингануть Redis) и BotRegistry
 * (через getMe живого бота проверяется Bot API вместе с зеркалом из
 * TELEGRAM_API_URL). Свой BullModule.registerQueue здесь ЗАПРЕЩЁН по тому же
 * доводу, что записан в QueuesModule: это вторые соединения с Redis и второе
 * место с опциями очередей. forwardRef — тоже по прецеденту QueuesModule: цикла
 * сейчас нет, но TelegramModule тяжёлый, и защита стоит одной обёртки.
 *
 * ErrorReporter и AppConfigService приходят сами: их модули глобальные.
 */
@Module({
  imports: [DatabaseModule, forwardRef(() => TelegramModule)],
  providers: [HealthMonitorService],
  // Наружу — ради команды /health: она показывает ровно то, по чему монитор
  // принимает решения, а не считает состояние вторым способом.
  exports: [HealthMonitorService],
})
export class HealthModule {}
