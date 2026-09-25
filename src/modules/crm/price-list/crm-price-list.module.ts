import { Module, forwardRef } from '@nestjs/common';

import { DatabaseModule } from '../../../database/database.module';
import { TelegramModule } from '../../telegram/telegram.module';
import { YandexModule } from '../../yandex/yandex.module';
import { CrmModule } from '../crm.module';

import { CrmPriceListController } from './crm-price-list.controller';
import { PriceListUploadInterceptor } from './price-list-upload.interceptor';

/**
 * «Прайс» CRM. Очередь file-processing — из TelegramModule (своя регистрация
 * значила бы второе соединение с Redis и второе место с опциями очереди;
 * forwardRef — прецедент CrmJobsModule). Барьеры записи — из YandexModule,
 * те же, что у бота.
 */
@Module({
  imports: [DatabaseModule, CrmModule, YandexModule, forwardRef(() => TelegramModule)],
  controllers: [CrmPriceListController],
  providers: [PriceListUploadInterceptor],
})
export class CrmPriceListModule {}
