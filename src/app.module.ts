import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TelegramModule } from './modules/telegram/telegram.module';
import { DatabaseModule } from './database/database.module';
import { CqrsModule } from '@nestjs/cqrs';
import { BullModule } from '@nestjs/bull';
import { AppConfigModule } from './config/app-config.module';
import { AppConfigService } from './config/app-config.service';

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
    TelegramModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
