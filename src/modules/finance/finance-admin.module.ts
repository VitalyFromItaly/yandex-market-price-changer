import { Module } from '@nestjs/common';

import { PostgresModule } from '../../database/postgres/postgres.module';
import { AdminAuthModule } from '../admin/admin-auth.module';

import { FinanceAdminController } from './finance-admin.controller';
import { FinanceTaxModule } from './finance-tax.module';

/**
 * Админский доступ к финансовому журналу. Отдельно от FinanceModule: его
 * импортирует TelegramModule ради процессора очереди, и тянуть в граф бота
 * гвард админки незачем (довод AiAdminModule).
 */
@Module({
  imports: [PostgresModule, AdminAuthModule, FinanceTaxModule],
  controllers: [FinanceAdminController],
})
export class FinanceAdminModule {}
