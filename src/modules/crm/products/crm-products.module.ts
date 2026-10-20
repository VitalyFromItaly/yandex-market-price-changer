import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../../database/database.module';
import { ProductsModule } from '../../products/products.module';
import { CrmModule } from '../crm.module';

import { CrmProductsController } from './crm-products.controller';

/**
 * «Товары» CRM (TASK-118). Логика — ProductsModule (список, правка закупа,
 * привязка); журнал — DatabaseModule; гвард — CrmModule. Маркет не нужен.
 */
@Module({
  imports: [CrmModule, DatabaseModule, ProductsModule],
  controllers: [CrmProductsController],
})
export class CrmProductsModule {}
