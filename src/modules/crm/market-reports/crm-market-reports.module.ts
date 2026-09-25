import { Module } from '@nestjs/common';

import { YandexModule } from '../../yandex/yandex.module';
import { CrmModule } from '../crm.module';
import { CrmJobsModule } from '../jobs/crm-jobs.module';

import { CrmMarketReportsController } from './crm-market-reports.controller';
import { CrmMarketReportsKinds } from './crm-market-reports.kinds';

/**
 * «Отчёты Маркета» в CRM: шесть kind-ов и опции форм. Сервисы —
 * `MarketReportsService`/`MarketCategoriesService` из YandexModule, общие с
 * ботом; магазин по ключу — `StoresService`; гвард — из CrmModule.
 */
@Module({
  imports: [CrmModule, CrmJobsModule, YandexModule],
  controllers: [CrmMarketReportsController],
  providers: [CrmMarketReportsKinds],
})
export class CrmMarketReportsModule {}
