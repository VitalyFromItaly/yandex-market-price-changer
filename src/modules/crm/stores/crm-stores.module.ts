import { Module } from '@nestjs/common';

import { YandexModule } from '../../yandex/yandex.module';
import { CrmModule } from '../crm.module';

import { CrmStoresController } from './crm-stores.controller';

/**
 * «Магазины» CRM: список магазинов токена, магазин по ключу, смена токена.
 * Сервис — `StoresService` из YandexModule, гвард — из CrmModule.
 */
@Module({
  imports: [CrmModule, YandexModule],
  controllers: [CrmStoresController],
})
export class CrmStoresModule {}
