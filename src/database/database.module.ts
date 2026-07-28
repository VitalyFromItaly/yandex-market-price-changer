import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DatabaseService } from './database.service';
import { SubscriptionService } from './services/subscription.service';
import { YandexMarketService } from './services/yandex-market.service';
import { Bot, BotSchema } from './schemas/bot.schema';
import { User, UserSchema } from './schemas/user.schema';
import { Subscription, SubscriptionSchema } from './schemas/subscription.schema';
import { YandexMarket, YandexMarketSchema } from './schemas/yandex-market.schema';
import { AppConfigService } from '../config/app-config.service';

@Module({
  imports: [
    // Раньше здесь стоял `import 'dotenv/config'` и чтение process.env прямо
    // в декораторе. Побочный эффект: этот модуль оказывался единственным, кто
    // подгружал .env, и от него зависела работоспособность Bull в app.module.
    MongooseModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        uri: config.mongoUrl,
        serverSelectionTimeoutMS: 30000, // 30 seconds
        socketTimeoutMS: 45000, // 45 seconds
        maxPoolSize: 10, // Maintain up to 10 socket connections
        minPoolSize: 5, // Maintain a minimum of 5 socket connections
        maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
        dbName: config.mongoDatabase,
      }),
    }),
    MongooseModule.forFeature([
      { name: Bot.name, schema: BotSchema },
      { name: User.name, schema: UserSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: YandexMarket.name, schema: YandexMarketSchema },
    ]),
  ],
  providers: [
    DatabaseService,
    SubscriptionService,
    YandexMarketService,
  ],
  exports: [
    DatabaseService,
    MongooseModule,
    SubscriptionService,
    YandexMarketService,
  ],
})
export class DatabaseModule {}
