import type { IAnalystAnswer, IAnalystAsk } from '../../ai-analyst/ai-analyst.service';
import type { IPeriodReview, IPeriodReviewAsk } from '../../ai-analyst/period-review.service';

import { Injectable } from '@nestjs/common';

import { AiAnalystService } from '../../ai-analyst/ai-analyst.service';
import { PeriodReviewService } from '../../ai-analyst/period-review.service';
import { ErrorReporter } from '../../errors/error-reporter.service';
import { InMemoryTurns } from '../crm-turns';

export type { ITurnView, TTurnStatus } from '../crm-turns';
export { TURN_FAILED_TEXT, TURN_TTL_MS, TurnRunningError } from '../crm-turns';

/** Ходы чата «ИИ-аналитика» (TASK-148). */
@Injectable()
export class AiAnalystTurns extends InMemoryTurns<IAnalystAsk, IAnalystAnswer> {
  constructor(
    private readonly analyst: AiAnalystService,
    errors: ErrorReporter,
  ) {
    super(errors, 'crm:ai-analyst');
  }

  protected run(input: IAnalystAsk, turnId: string): Promise<IAnalystAnswer> {
    return this.analyst.ask({ ...input, turnId });
  }
}

/** Ходы «ИИ-разбора периода» (TASK-150). */
@Injectable()
export class PeriodReviewTurns extends InMemoryTurns<IPeriodReviewAsk, IPeriodReview> {
  constructor(
    private readonly reviews: PeriodReviewService,
    errors: ErrorReporter,
  ) {
    super(errors, 'crm:ai-period-review');
  }

  protected run(input: IPeriodReviewAsk, turnId: string): Promise<IPeriodReview> {
    return this.reviews.review({ ...input, turnId });
  }
}
