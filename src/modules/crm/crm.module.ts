import type { MiddlewareConsumer, NestModule } from '@nestjs/common';

import { Module, RequestMethod } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { DatabaseModule } from '../../database/database.module';

import { CrmActionLogMiddleware } from './crm-action-log.middleware';
import { CrmAuthController } from './crm-auth.controller';
import { CrmAuthService } from './crm-auth.service';
import { CrmJwtGuard } from './crm-jwt.guard';

/**
 * CRM продавцов: вход, гейт фич (внутри CrmJwtGuard) и журнал запросов.
 *
 * `JwtModule.register({})` без глобального секрета — по той же причине, что в
 * AdminAuthModule: секрет лежит в Mongo и передаётся в каждый вызов.
 * Гвард экспортируется для будущих контроллеров CRM (/api/crm/ym/...).
 *
 * Журнал вешается по ПУТИ, а не по списку контроллеров: новый контроллер CRM
 * попадает в журнал сам, забыть его здесь нельзя. Глобальный префикс `/api`
 * Nest добавляет к пути middleware сам.
 *
 * Фоновые задачи — отдельный CrmJobsModule: им нужна очередь из
 * TelegramModule, а этот модуль (вход и гейт) обязан подниматься без графа бота.
 */
@Module({
  imports: [DatabaseModule, JwtModule.register({})],
  controllers: [CrmAuthController],
  providers: [CrmAuthService, CrmJwtGuard],
  exports: [CrmAuthService, CrmJwtGuard],
})
export class CrmModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(CrmActionLogMiddleware)
      .forRoutes({ path: 'crm/{*path}', method: RequestMethod.ALL });
  }
}
