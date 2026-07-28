import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TelegramModule } from './modules/telegram/telegram.module';
import { DatabaseModule } from './database/database.module';
import { CqrsModule } from '@nestjs/cqrs';
import { BullModule } from '@nestjs/bull';

@Module({
  imports: [
    CqrsModule.forRoot(),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
      },
    }),
    DatabaseModule,
    TelegramModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
