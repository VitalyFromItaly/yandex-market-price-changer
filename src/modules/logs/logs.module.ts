import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AdminAuthModule } from '../admin/admin-auth.module';

import { LogsController } from './logs.controller';

/**
 * Админское чтение журнала действий.
 *
 * Отдельный модуль, а не роут внутри TelegramModule: тот собирает ботов и
 * очереди, и добавление в него HTTP-эндпоинта с собственной авторизацией
 * смешало бы две несвязанные ответственности. Писать журнал будет telegram,
 * читать — этот модуль; общий у них только сервис из DatabaseModule.
 *
 * Гвард приходит из AdminAuthModule вместе с сервисом, который он зовёт, —
 * держать его копию здесь значило бы иметь два независимых экземпляра.
 */
@Module({
  imports: [DatabaseModule, AdminAuthModule],
  controllers: [LogsController],
})
export class LogsModule {}
