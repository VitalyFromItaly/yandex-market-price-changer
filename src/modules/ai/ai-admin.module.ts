import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AdminAuthModule } from '../admin/admin-auth.module';

import { AiAdminController } from './ai-admin.controller';
import { AiModule } from './ai.module';

/**
 * Страница «ИИ» админ-панели: расход по AiUsage и баланс Polza.
 *
 * Отдельно от AiModule: его импортируют монитор и хендлеры, а гвард админки им
 * не нужен. Баланс — только через AiService, PolzaClient по-прежнему не
 * экспортируется.
 */
@Module({
  imports: [DatabaseModule, AdminAuthModule, AiModule],
  controllers: [AiAdminController],
})
export class AiAdminModule {}
