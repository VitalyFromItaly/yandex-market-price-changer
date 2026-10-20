import type { IAnalystSource, IAnswerVerification } from './ai-analyst.domain';
import type { IAiToolInvocation } from '../ai/ai-tools.types';
import type { TFeatureKey } from '../telegram/bots/shared/features.domain';

import { Injectable } from '@nestjs/common';

import { AiTurnService } from '../../database/services/ai-turn.service';
import { ANALYST_PURPOSE } from '../ai/ai-purpose';
import { AiService } from '../ai/ai.service';
import { AiToolsService } from '../ai-tools/ai-tools.service';

import {
  gapsOf,
  normalizeHistory,
  sourcesOf,
  toPolzaMessages,
  verifyAnswer,
} from './ai-analyst.domain';
import { turnQualityOf } from './turn-quality.domain';

/** Модель промолчала: продавцу — честная фраза, а не пустой пузырь. */
export const EMPTY_ANSWER_TEXT = 'Ответа нет — попробуйте переформулировать вопрос.';

export interface IAnalystAsk {
  telegramUserId: string;
  /** Открыта ли фича `ai` — готовым boolean, решение `AiService`. */
  aiAllowed: boolean;
  /**
   * Открытые фичи экранов (`AI_GATED_FEATURES`, TASK-151/165): инструмент экрана
   * с закрытой фичей не попадает в набор и в промпт. Не передано — все закрыты.
   */
  features?: readonly TFeatureKey[];
  /** История из вкладки — как пришла; проверяется здесь. */
  messages: unknown;
  /** Строка учёта AiUsage; по умолчанию `analyst`. Контрольный набор — `eval` (TASK-169). */
  purpose?: string;
  /**
   * id хода CRM: передан — счётчики качества хода пишутся в AiTurn (TASK-170), по нему
   * же продавец ставит 👍/👎. Без него (контрольный набор) строки нет.
   */
  turnId?: string;
}

export interface IAnalystAnswer {
  answer: string;
  verification: IAnswerVerification;
  sources: IAnalystSource[];
  /** Причины «данных недостаточно» из инструментов. */
  gaps: string[];
  rounds: number;
  /** Вызовы инструментов по порядку — для контрольного набора; в CRM не отдаются. */
  toolResults: IAiToolInvocation[];
  /** Стоимость хода, ₽ — сумма всех раундов. */
  costRub: number;
}

/** История не прошла проверку — вызывающий отвечает 400 с этим текстом. */
export class AnalystHistoryError extends Error {}

/**
 * «ИИ-аналитик» (TASK-148): один ход чата. Модель спрашивает числа у
 * инструментов (`AiToolsService`), ответ сверяется с тем, что они отдали.
 *
 * Отказы `AiService` (`AiError` — фича, лимит, ИИ выключен) и сбои Polza
 * (`PolzaApiError`) пробрасываются как есть: первые — не сбой, вторые
 * `AiService` уже отрепортил сам. Текст переписки нигде не сохраняется.
 */
@Injectable()
export class AiAnalystService {
  constructor(
    private readonly ai: AiService,
    private readonly tools: AiToolsService,
    private readonly turns: AiTurnService,
  ) {}

  public async ask(input: IAnalystAsk, now = new Date()): Promise<IAnalystAnswer> {
    const history = normalizeHistory(input.messages);
    if (typeof history === 'string') throw new AnalystHistoryError(history);

    const toolbox = this.tools.toolbox(input.telegramUserId, () => now, {
      features: new Set(input.features ?? []),
    });
    // Промпт говорит только о тех инструментах, что модель видит.
    const purpose = input.purpose ?? ANALYST_PURPOSE;
    const visible = new Set(toolbox.definitions.map((tool) => tool.function.name));
    const completion = await this.ai.completeWithTools(
      {
        telegramUserId: input.telegramUserId,
        aiAllowed: input.aiAllowed,
        purpose,
      },
      { messages: toPolzaMessages(history, now, visible) },
      toolbox,
      now,
    );

    const answer = completion.content?.trim() || EMPTY_ANSWER_TEXT;
    const question = history[history.length - 1].content;
    const verification = verifyAnswer(answer, question, completion.toolResults);
    if (input.turnId) {
      await this.turns.record({
        turnId: input.turnId,
        telegramUserId: input.telegramUserId,
        purpose,
        ...turnQualityOf({
          answer,
          question,
          verification,
          toolResults: completion.toolResults,
          rounds: completion.rounds,
        }),
      });
    }
    return {
      answer,
      verification,
      sources: sourcesOf(completion.toolResults),
      gaps: gapsOf(completion.toolResults),
      rounds: completion.rounds,
      toolResults: completion.toolResults,
      costRub: completion.costRub,
    };
  }
}
