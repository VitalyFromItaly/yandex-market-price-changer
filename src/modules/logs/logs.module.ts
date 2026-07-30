import { Module } from '@nestjs/common';

import { AdminApiGuard } from '../../common/guards/admin-api.guard';
import { DatabaseModule } from '../../database/database.module';

import { LogsController } from './logs.controller';

/**
 * Админское чтение журнала действий.
 *
 * Отдельный модуль, а не роут внутри TelegramModule: тот собирает ботов и
 * очереди, и добавление в него HTTP-эндпоинта с собственной авторизацией
 * смешало бы две несвязанные ответственности. Писать журнал будет telegram,
 * читать — этот модуль; общий у них только сервис из DatabaseModule.
 *
 * AppConfigService гварду доступен без импорта: AppConfigModule объявлен
 * глобальным.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [LogsController],
  providers: [AdminApiGuard],
})
export class LogsModule {}
