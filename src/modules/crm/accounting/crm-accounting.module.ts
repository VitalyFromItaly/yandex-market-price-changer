import { Module } from '@nestjs/common';

import { AccountingModule } from '../../accounting/accounting.module';
import { ProductsModule } from '../../products/products.module';
import { WbModule } from '../../wb/wb.module';
import { CrmModule } from '../crm.module';
import { CrmJobsModule } from '../jobs/crm-jobs.module';

import { CrmAccountingController } from './crm-accounting.controller';
import { CrmAccountingKinds } from './crm-accounting.kinds';

/**
 * «Финучёт» CRM (TASK-206): маршруты раздела `ym-accounting`; kind налога года — TASK-221;
 * WbModule — загрузка отчёта WB «Продвижение» файлом (TASK-209); ProductsModule — поиск
 * товара для истории закупа v2 (TASK-235).
 */
@Module({
  imports: [AccountingModule, CrmModule, CrmJobsModule, ProductsModule, WbModule],
  controllers: [CrmAccountingController],
  providers: [CrmAccountingKinds],
})
export class CrmAccountingModule {}
