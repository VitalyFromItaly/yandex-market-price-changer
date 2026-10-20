import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AdminAuthModule } from '../admin/admin-auth.module';

import { ProductAdminController } from './product-admin.controller';
import { ProductsModule } from './products.module';

/**
 * Админский доступ к сопоставлению карточек. Отдельно от ProductsModule: его
 * импортирует YandexModule, и тянуть в граф бота гвард админки незачем.
 */
@Module({
  imports: [DatabaseModule, AdminAuthModule, ProductsModule],
  controllers: [ProductAdminController],
})
export class ProductAdminModule {}
