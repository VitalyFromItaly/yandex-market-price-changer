import { Module } from '@nestjs/common';

import { YandexModule } from '../../yandex/yandex.module';
import { CrmModule } from '../crm.module';

import { CrmFeedbackController } from './crm-feedback.controller';

/**
 * «Отзывы» CRM. Сервис — `FeedbackService` из YandexModule, общий с ботом;
 * магазин по ключу — `StoresService`; гвард — из CrmModule.
 */
@Module({
  imports: [CrmModule, YandexModule],
  controllers: [CrmFeedbackController],
})
export class CrmFeedbackModule {}
