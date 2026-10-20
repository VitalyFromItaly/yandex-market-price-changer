import type { ICrmFeedbackDraft } from './crm-feedback.domain';
import type { ITurnView } from '../crm-turns';

import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { FEATURE, isFeatureEnabled } from '../../telegram/bots/shared/features.domain';
import { StoresService } from '../../yandex/stores/stores.service';
import { RequireFeature } from '../crm-auth.decorators';
import { CrmJwtGuard, IRequestWithCrmUser } from '../crm-jwt.guard';
import { TURN_NOT_FOUND, TURN_RUNNING, TurnRunningError } from '../crm-turns';

import { FeedbackDraftTurns } from './crm-feedback-draft.turns';
import { feedbackIdOf, resolveFeedbackStore } from './crm-feedback.controller';

/** Ответ перечислением полей: в ответ не уедет ничего сверх задуманного. */
function toView(turn: ITurnView<ICrmFeedbackDraft>): ITurnView<ICrmFeedbackDraft> {
  if (turn.status === 'failed') return { status: 'failed', message: turn.message };
  if (turn.status === 'running' || !turn.answer) return { status: 'running' };
  const a = turn.answer;
  return { status: 'done', answer: { text: a.text, gone: a.gone, message: a.message } };
}

/**
 * «✨ Предложить ответ» в «Отзывах» CRM (TASK-167):
 * /api/crm/ym/feedback/draft/turns.
 *
 * Своя фича `feedback_ai_reply` (требует `goods_feedback` и `ai`) на всём
 * классе — закрытая любая из них даёт 403 до `AiService`. Только черновик:
 * публикует прежний `POST crm/ym/feedback/reply` из превью. Логика —
 * `FeedbackDraftService`, здесь доставка.
 */
@Controller('crm/ym/feedback/draft')
@UseGuards(CrmJwtGuard)
@RequireFeature(FEATURE.FEEDBACK_AI_REPLY)
export class CrmFeedbackDraftController {
  constructor(
    private readonly stores: StoresService,
    private readonly turns: FeedbackDraftTurns,
  ) {}

  @Post('turns')
  async start(
    @Req() request: IRequestWithCrmUser,
    @Body() body: Record<string, unknown>,
  ): Promise<{ turnId: string }> {
    const user = request.crmUser;
    const feedbackId = feedbackIdOf(body);
    const { store } = await resolveFeedbackStore(
      this.stores,
      user.telegramUserId,
      body?.store,
      'crm-feedback:draft',
    );

    try {
      const turnId = this.turns.start({
        telegramUserId: user.telegramUserId,
        aiAllowed: isFeatureEnabled(user.features, FEATURE.AI),
        feedbackId,
        store,
      });
      return { turnId };
    } catch (error) {
      if (!(error instanceof TurnRunningError)) throw error;
      throw new ConflictException({
        statusCode: 409,
        code: TURN_RUNNING,
        turnId: error.turnId,
        message: 'Черновик уже готовится — дождитесь его.',
      });
    }
  }

  @Get('turns/:id')
  view(@Req() request: IRequestWithCrmUser, @Param('id') id: string): ITurnView<ICrmFeedbackDraft> {
    const turn = this.turns.view(request.crmUser.telegramUserId, id);
    if (!turn) {
      throw new NotFoundException({
        statusCode: 404,
        code: TURN_NOT_FOUND,
        message: 'Черновик не найден — попросите ещё раз.',
      });
    }
    return toView(turn);
  }
}
