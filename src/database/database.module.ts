import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AppConfigService } from '../config/app-config.service';

import { DatabaseService } from './database.service';
import { Bot, BotSchema } from './schemas/bot.schema';
import { PurchasePrice, PurchasePriceSchema } from './schemas/purchase-price.schema';
import { ReportSchedule, ReportScheduleSchema } from './schemas/report-schedule.schema';
import { UserAccess, UserAccessSchema } from './schemas/user-access.schema';
import { User, UserSchema } from './schemas/user.schema';
import { YandexMarket, YandexMarketSchema } from './schemas/yandex-market.schema';
import { PurchasePriceService } from './services/purchase-price.service';
import { ReportScheduleService } from './services/report-schedule.service';
import { UserAccessService } from './services/user-access.service';
import { YandexMarketService } from './services/yandex-market.service';

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
      { name: UserAccess.name, schema: UserAccessSchema },
      { name: ReportSchedule.name, schema: ReportScheduleSchema },
      { name: PurchasePrice.name, schema: PurchasePriceSchema },
      { name: YandexMarket.name, schema: YandexMarketSchema },
    ]),
  ],
  providers: [
    DatabaseService,
    UserAccessService,
    ReportScheduleService,
    PurchasePriceService,
    YandexMarketService,
  ],
  exports: [
    DatabaseService,
    MongooseModule,
    UserAccessService,
    ReportScheduleService,
    PurchasePriceService,
    YandexMarketService,
  ],
})
export class DatabaseModule {}
