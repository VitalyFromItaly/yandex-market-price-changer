import { Module, forwardRef } from '@nestjs/common';

import { DatabaseModule } from '../../../database/database.module';
import { TelegramModule } from '../../telegram/telegram.module';
import { CrmModule } from '../crm.module';

import { CrmNotificationsController } from './crm-notifications.controller';

/**
 * «Уведомления» CRM (TASK-152). Лента и настройки — из DatabaseModule,
 * планировщик проверки — из TelegramModule (там же очередь и процессор).
 */
@Module({
  imports: [CrmModule, DatabaseModule, forwardRef(() => TelegramModule)],
  controllers: [CrmNotificationsController],
})
export class CrmNotificationsModule {}
