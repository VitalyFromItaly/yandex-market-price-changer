import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../../database/database.module';
import { AiAnalystModule } from '../../ai-analyst/ai-analyst.module';
import { CrmModule } from '../crm.module';

import { CrmAiAnalystController } from './crm-ai-analyst.controller';
import { AiAnalystTurns, PeriodReviewTurns } from './crm-ai-analyst.turns';
import { CrmAiPeriodReviewController } from './crm-ai-period-review.controller';

/**
 * «ИИ-аналитик» CRM: гвард — из CrmModule, ход чата и разбор периода (TASK-150) —
 * из AiAnalystModule. У каждой вкладки свои ходы и своя фича. DatabaseModule — ради
 * AiTurnService (оценка ответа): модуль базы не глобальный.
 */
@Module({
  imports: [DatabaseModule, CrmModule, AiAnalystModule],
  controllers: [CrmAiAnalystController, CrmAiPeriodReviewController],
  providers: [AiAnalystTurns, PeriodReviewTurns],
})
export class CrmAiAnalystModule {}
