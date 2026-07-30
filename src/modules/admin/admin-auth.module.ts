import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { DatabaseModule } from '../../database/database.module';

import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminJwtGuard } from './admin-jwt.guard';

/**
 * Вход в админ-панель.
 *
 * `JwtModule.register({})` — БЕЗ глобального секрета, и это осознанно: секрет
 * лежит в Mongo (см. AdminCredential) и передаётся параметром в каждый
 * signAsync/verifyAsync. Иначе фабрика модуля должна была бы читать базу в
 * момент инициализации DI, то есть порядок модулей стал бы зависеть от того,
 * успело ли подняться подключение к Mongo.
 */
@Module({
  imports: [DatabaseModule, JwtModule.register({})],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminJwtGuard],
  exports: [AdminAuthService, AdminJwtGuard],
})
export class AdminAuthModule {}
