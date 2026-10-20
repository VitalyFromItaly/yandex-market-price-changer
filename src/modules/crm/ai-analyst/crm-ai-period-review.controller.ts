import type { ITurnView } from './crm-ai-analyst.turns';
import type { IAnalystSource } from '../../ai-analyst/ai-analyst.domain';
import type { IPeriodReview } from '../../ai-analyst/period-review.service';

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { AiTurnService } from '../../../database/services/ai-turn.service';
import { PERIOD_REVIEW_PURPOSE } from '../../ai-analyst/period-review.service';
import { AI_MARKETPLACE_FEATURES } from '../../ai-tools/ai-tools.domain';
import { financeToday } from '../../finance/finance-period';
import { parseScreenMonth, screenMonths } from '../../finance/finance-screen';
import { FEATURE, isFeatureEnabled } from '../../telegram/bots/shared/features.domain';
import { RequireFeature } from '../crm-auth.decorators';
import { CrmJwtGuard, IRequestWithCrmUser } from '../crm-jwt.guard';

import { rateTurn, TURN_NOT_FOUND, TURN_RUNNING } from './crm-ai-analyst.controller';
import { PeriodReviewTurns, TurnRunningError } from './crm-ai-analyst.turns';

export const INVALID_MONTH = 'INVALID_MONTH';
export const INVALID_MONTH_TEXT = 'Месяц: текущий или один из двенадцати прошлых, ГГГГ-ММ';

const sourceView = (s: IAnalystSource): IAnalystSource => ({
  source: s.source,
  label: s.label,
  period: s.period,
  operationIds: s.operationIds,
  operationCount: s.operationCount,
  documentIds: s.documentIds,
});

/** Ответ перечислением полей: в ответ не уедет ничего сверх задуманного. */
function toView(turn: ITurnView<IPeriodReview>): ITurnView<IPeriodReview> {
  if (turn.status === 'failed') return { status: 'failed', message: turn.message };
  if (turn.status === 'running' || !turn.answer) return { status: 'running' };
  const a = turn.answer;
  return {
    status: 'done',
    answer: {
      month: a.month,
      previousMonth: a.previousMonth,
      answer: a.answer,
      verification: { verified: a.verification.verified, unconfirmed: a.verification.unconfirmed },
      recommendations: a.recommendations.map((r) => ({
        id: r.id,
        kind: r.kind,
        sku: r.sku,
        name: r.name,
        avgPriceKopecks: r.avgPriceKopecks,
        minPriceKopecks: r.minPriceKopecks,
        netKopecks: r.netKopecks,
        units: r.units,
        schemes: r.schemes,
        text: r.text,
        source: sourceView(r.source),
      })),
      sources: a.sources.map(sourceView),
      gaps: a.gaps,
    },
  };
}

/**
 * «ИИ-разбор периода» CRM (TASK-150). Полный адрес — /api/crm/ym/ai-analyst/review.
 * Вкладка раздела «ИИ-аналитик» под своей фичей `ai_period_review`, которая
 * требует `ai` и `finance` (TASK-153): закрытая любая — 403 до `AiService`.
 * Логика — `PeriodReviewService`, здесь доставка.
 */
@Controller('crm/ym/ai-analyst/review')
@UseGuards(CrmJwtGuard)
@RequireFeature(FEATURE.AI_PERIOD_REVIEW)
export class CrmAiPeriodReviewController {
  constructor(
    private readonly turns: PeriodReviewTurns,
    private readonly aiTurns: AiTurnService,
  ) {}

  @Post('turns')
  start(@Req() request: IRequestWithCrmUser, @Body() body: unknown): { turnId: string } {
    const month = parseScreenMonth((body as { month?: unknown } | null)?.month);
    const allowed = screenMonths(financeToday()).some((m) => m.month === month?.month);
    if (!month || !allowed)
      throw new BadRequestException({
        statusCode: 400,
        code: INVALID_MONTH,
        message: INVALID_MONTH_TEXT,
      });
    const user = request.crmUser;
    try {
      const turnId = this.turns.start({
        telegramUserId: user.telegramUserId,
        aiAllowed: isFeatureEnabled(user.features, FEATURE.AI),
        month,
        // Закрытая площадка в блок сравнения не читается (как экран «Сравнение площадок»).
        features: AI_MARKETPLACE_FEATURES.filter((feature) =>
          isFeatureEnabled(user.features, feature),
        ),
      });
      return { turnId };
    } catch (error) {
      if (error instanceof TurnRunningError) {
        throw new ConflictException({
          statusCode: 409,
          code: TURN_RUNNING,
          turnId: error.turnId,
          message: 'Разбор уже идёт',
        });
      }
      throw error;
    }
  }

  @Get('turns/:id')
  view(@Req() request: IRequestWithCrmUser, @Param('id') id: string): ITurnView<IPeriodReview> {
    const turn = this.turns.view(request.crmUser.telegramUserId, id);
    if (!turn)
      throw new NotFoundException({
        statusCode: 404,
        code: TURN_NOT_FOUND,
        message: 'Разбор не найден',
      });
    return toView(turn);
  }

  /** 👍/👎 разбора (TASK-170): счётчики хода пишутся, только если модель звали. */
  @Post('turns/:id/rating')
  @HttpCode(200)
  rate(
    @Req() request: IRequestWithCrmUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ rating: 'up' | 'down' }> {
    return rateTurn(this.aiTurns, request, id, PERIOD_REVIEW_PURPOSE, body, 'Разбор не найден');
  }
}
