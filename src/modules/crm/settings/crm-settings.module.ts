import { Module } from '@nestjs/common';

import { YandexModule } from '../../yandex/yandex.module';
import { CrmModule } from '../crm.module';

import { CrmSettingsController } from './crm-settings.controller';

/**
 * «Настройки» CRM. Сервис настроек берётся из YandexModule, где его берёт и
 * бот: единый путь записи для обоих каналов. Гвард — из CrmModule.
 */
@Module({
  imports: [CrmModule, YandexModule],
  controllers: [CrmSettingsController],
})
export class CrmSettingsModule {}
