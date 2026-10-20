import type { ITurnView } from './crm-ai-analyst.turns';
import type { IAnalystAnswer } from '../../ai-analyst/ai-analyst.service';

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
import { ANALYST_PURPOSE } from '../../ai/ai-purpose';
import { normalizeHistory } from '../../ai-analyst/ai-analyst.domain';
import { AI_GATED_FEATURES } from '../../ai-tools/ai-tools.domain';
import { FEATURE, isFeatureEnabled } from '../../telegram/bots/shared/features.domain';
import { RequireFeature } from '../crm-auth.decorators';
import { CrmJwtGuard, IRequestWithCrmUser } from '../crm-jwt.guard';
import { INVALID_RATING, parseTurnRating, TURN_NOT_FOUND, TURN_RUNNING } from '../crm-turns';

import { AiAnalystTurns, TurnRunningError } from './crm-ai-analyst.turns';

export const INVALID_MESSAGES = 'INVALID_MESSAGES';
// Коды переехали в общий crm-turns.ts; реэкспорт — для соседей и тестов.
export { INVALID_RATING, TURN_NOT_FOUND, TURN_RUNNING };

/**
 * 👍/👎 хода (TASK-170) — общая доставка чата и разбора: тело проверяется здесь,
 * владение — фильтром `AiTurnService.rate` (чужой ход — тот же 404, что и несуществующий).
 */
export async function rateTurn(
  aiTurns: AiTurnService,
  request: IRequestWithCrmUser,
  id: string,
  purpose: string,
  body: unknown,
  notFoundText: string,
): Promise<{ rating: 'up' | 'down' }> {
  const rating = parseTurnRating(body);
  if (!rating)
    throw new BadRequestException({
      statusCode: 400,
      code: INVALID_RATING,
      message: 'Оценка — up или down',
    });
  const rated = await aiTurns.rate(request.crmUser.telegramUserId, id, purpose, rating);
  if (!rated)
    throw new NotFoundException({ statusCode: 404, code: TURN_NOT_FOUND, message: notFoundText });
  return { rating };
}

/** Что видит CRM: вызовы инструментов и стоимость — для контрольного набора, не продавцу. */
type TAnalystAnswerView = Omit<IAnalystAnswer, 'toolResults' | 'costRub'>;

/** Ответ перечислением полей: в ответ не уедет ничего сверх задуманного. */
function toView(turn: ITurnView<IAnalystAnswer>): ITurnView<TAnalystAnswerView> {
  if (turn.status === 'failed') return { status: 'failed', message: turn.message };
  if (turn.status === 'running' || !turn.answer) return { status: 'running' };
  const { answer, verification, sources, gaps, rounds } = turn.answer;
  return {
    status: 'done',
    answer: {
      answer,
      verification: { verified: verification.verified, unconfirmed: verification.unconfirmed },
      sources: sources.map((s) => ({
        source: s.source,
        label: s.label,
        period: s.period,
        operationIds: s.operationIds,
        operationCount: s.operationCount,
        documentIds: s.documentIds,
      })),
      gaps,
      rounds,
    },
  };
}

/**
 * «ИИ-аналитик» CRM (TASK-148). Полный адрес — /api/crm/ym/ai-analyst. Раздел
 * аккаунта под фичей `ai_analyst`, которая требует `ai` и `finance` — закрытая
 * любая из них закрывает и маршрут (зависимости свёрнуты в фичу, TASK-153).
 * Логика — `AiAnalystService`, здесь только доставка.
 */
@Controller('crm/ym/ai-analyst')
@UseGuards(CrmJwtGuard)
@RequireFeature(FEATURE.AI_ANALYST)
export class CrmAiAnalystController {
  constructor(
    private readonly turns: AiAnalystTurns,
    private readonly aiTurns: AiTurnService,
  ) {}

  @Post('turns')
  start(@Req() request: IRequestWithCrmUser, @Body() body: unknown): { turnId: string } {
    const messages = (body as { messages?: unknown } | null)?.messages;
    const history = normalizeHistory(messages);
    if (typeof history === 'string')
      throw new BadRequestException({ statusCode: 400, code: INVALID_MESSAGES, message: history });
    const user = request.crmUser;
    try {
      const turnId = this.turns.start({
        telegramUserId: user.telegramUserId,
        // Последний барьер — AiService; ему — готовый boolean (админ уже «всё открыто»).
        aiAllowed: isFeatureEnabled(user.features, FEATURE.AI),
        // Инструмент экрана — только при открытой фиче экрана (ai_tools_by_screen_feature).
        features: AI_GATED_FEATURES.filter((feature) => isFeatureEnabled(user.features, feature)),
        messages: history,
      });
      return { turnId };
    } catch (error) {
      if (error instanceof TurnRunningError) {
        throw new ConflictException({
          statusCode: 409,
          code: TURN_RUNNING,
          turnId: error.turnId,
          message: 'Предыдущий вопрос ещё обрабатывается',
        });
      }
      throw error;
    }
  }

  @Get('turns/:id')
  view(
    @Req() request: IRequestWithCrmUser,
    @Param('id') id: string,
  ): ITurnView<TAnalystAnswerView> {
    const turn = this.turns.view(request.crmUser.telegramUserId, id);
    if (!turn)
      throw new NotFoundException({
        statusCode: 404,
        code: TURN_NOT_FOUND,
        message: 'Ход не найден',
      });
    return toView(turn);
  }

  /** Оценка ответа продавцом; повтор заменяет прежнюю. Ход в памяти уже мог истечь — смотрим AiTurn. */
  @Post('turns/:id/rating')
  @HttpCode(200)
  rate(
    @Req() request: IRequestWithCrmUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ rating: 'up' | 'down' }> {
    return rateTurn(this.aiTurns, request, id, ANALYST_PURPOSE, body, 'Ход не найден');
  }
}
