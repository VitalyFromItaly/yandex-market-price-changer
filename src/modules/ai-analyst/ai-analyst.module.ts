import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AiModule } from '../ai/ai.module';
import { AiToolsModule } from '../ai-tools/ai-tools.module';
import { FinanceCashflowModule } from '../finance/finance-cashflow.module';
import { FinanceScreenModule } from '../finance/finance-screen.module';
import { FinanceModule } from '../finance/finance.module';

import { AiAnalystService } from './ai-analyst.service';
import { PeriodReviewService } from './period-review.service';
import { WeeklyDigestService } from './weekly-digest.service';

/**
 * «ИИ-аналитик» (TASK-148): логика хода чата — промпт, сверка чисел, ссылки.
 * Доставка в CRM — `src/modules/crm/ai-analyst/`. AiModule отдаёт только
 * AiService (единственная дверь к Polza), AiToolsModule — набор инструментов.
 * «ИИ-разбор периода» (TASK-150) берёт факты из финансов напрямую — без цикла инструментов;
 * так же — еженедельная сводка в Telegram (TASK-168, `WeeklyDigestService`).
 */
@Module({
  imports: [
    AiModule,
    AiToolsModule,
    DatabaseModule,
    FinanceModule,
    FinanceScreenModule,
    FinanceCashflowModule,
  ],
  providers: [AiAnalystService, PeriodReviewService, WeeklyDigestService],
  exports: [AiAnalystService, PeriodReviewService, WeeklyDigestService],
})
export class AiAnalystModule {}
