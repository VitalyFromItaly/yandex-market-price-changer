import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';

import { ProductCatalogService } from './product-catalog.service';
import { ProductMatchService } from './product-match.service';

/**
 * База товаров: сопоставление карточек площадок (TASK-117). Импортирует его
 * YandexModule (заполнение из каталога ЯМ) и ProductAdminModule (ручная
 * привязка), CRM «Товары» — ещё и список с правкой закупа (TASK-118); гвард
 * админки сюда не тянется — довод AiAdminModule.
 */
@Module({
  imports: [DatabaseModule],
  providers: [ProductMatchService, ProductCatalogService],
  exports: [ProductMatchService, ProductCatalogService],
})
export class ProductsModule {}
