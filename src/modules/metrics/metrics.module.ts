import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AdminAuthModule } from '../admin/admin-auth.module';

import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

/**
 * Чтение метрик для админ-панели. Пишут их другие (TelegramApiMetrics,
 * HealthMonitorService, ActionLogHandler) — этот модуль только сворачивает,
 * по образцу LogsModule.
 */
@Module({
  imports: [DatabaseModule, AdminAuthModule],
  controllers: [MetricsController],
  providers: [MetricsService],
})
export class MetricsModule {}
