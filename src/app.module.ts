import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigModule } from './config/app-config.module';
import { AppConfigService } from './config/app-config.service';
import { DatabaseModule } from './database/database.module';
import { AdminAuthModule } from './modules/admin/admin-auth.module';
import { ErrorsModule } from './modules/errors/errors.module';
import { LogsModule } from './modules/logs/logs.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { YandexModule } from './modules/yandex/yandex.module';

@Module({
  imports: [
    // Первым: валидирует окружение до того, как остальные модули начнут его
    // читать. Раньше настройки Redis вычислялись прямо в декораторе ниже, из
    // process.env, и работали лишь потому, что `import 'dotenv/config'` из
    // database.module.ts успевал исполниться раньше. Перестановка импортов
    // молча увела бы Bull на localhost.
    AppConfigModule,
    CqrsModule.forRoot(),
    BullModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        redis: {
          host: config.redisHost,
          port: config.redisPort,
          password: config.redisPassword,
        },
      }),
    }),
    DatabaseModule,
    ErrorsModule,
    AdminAuthModule,
    LogsModule,
    YandexModule,
    TelegramModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
