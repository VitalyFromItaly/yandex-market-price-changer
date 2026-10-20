import { Module } from '@nestjs/common';

import { InventoryModule } from '../../inventory/inventory.module';
import { CrmJobsModule } from '../jobs/crm-jobs.module';

import { CrmInventoryKinds } from './crm-inventory.kinds';

/** «Склад» CRM (TASK-142). Контроллера нет: один kind фоновых задач поверх `InventoryService`. */
@Module({
  imports: [CrmJobsModule, InventoryModule],
  providers: [CrmInventoryKinds],
})
export class CrmInventoryModule {}
