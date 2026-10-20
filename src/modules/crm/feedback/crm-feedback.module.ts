import { Module } from '@nestjs/common';

import { YandexModule } from '../../yandex/yandex.module';
import { CrmModule } from '../crm.module';

import { CrmFeedbackDraftController } from './crm-feedback-draft.controller';
import { FeedbackDraftTurns } from './crm-feedback-draft.turns';
import { CrmFeedbackController } from './crm-feedback.controller';

/**
 * «Отзывы» CRM. Сервис — `FeedbackService` из YandexModule, общий с ботом;
 * магазин по ключу — `StoresService`; гвард — из CrmModule. Черновик ИИ —
 * `FeedbackDraftService` (тоже YandexModule) через ходы в памяти.
 */
@Module({
  imports: [CrmModule, YandexModule],
  controllers: [CrmFeedbackController, CrmFeedbackDraftController],
  providers: [FeedbackDraftTurns],
})
export class CrmFeedbackModule {}
