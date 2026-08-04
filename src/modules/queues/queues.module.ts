import { Module, forwardRef } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AdminAuthModule } from '../admin/admin-auth.module';
import { TelegramModule } from '../telegram/telegram.module';

import { QueuesController } from './queues.controller';
import { QueuesService } from './queues.service';

/**
 * Админское чтение очередей Bull (и ретрай упавших задач).
 *
 * Отдельный модуль по той же причине, что LogsModule и AccessModule:
 * TelegramModule очереди КРУТИТ, этот — только читает. Инстансы очередей
 * приходят реэкспортом BullModule из TelegramModule: свой registerQueue
 * означал бы вторые соединения с Redis и второе место с опциями очередей.
 *
 * `forwardRef` — по прецеденту AccessModule: цикла сейчас нет, но
 * TelegramModule тяжёлый, и защита от будущего цикла стоит одной обёртки.
 */
@Module({
  imports: [DatabaseModule, AdminAuthModule, forwardRef(() => TelegramModule)],
  controllers: [QueuesController],
  providers: [QueuesService],
})
export class QueuesModule {}
