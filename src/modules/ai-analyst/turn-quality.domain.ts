import type { IAnswerVerification } from './ai-analyst.domain';
import type { IAiToolInvocation } from '../ai/ai-tools.types';

import { checkedNumbers } from './ai-analyst.domain';
import { asksBack } from './analyst-eval.domain';

/** Счётчики качества одного хода ИИ (TASK-170) — без текста вопроса и ответа. */
export interface ITurnQuality {
  numbers: number;
  unconfirmed: number;
  toolCalls: number;
  rounds: number;
  asksBackNoTools: boolean;
}

/**
 * Числа — тот же список, что сверяет `verifyAnswer` (`checkedNumbers`);
 * «уточняющий без инструментов» — эвристика контрольного набора `asksBack`
 * и ни одного вызова инструмента: модель переспросила, не заглянув в данные
 * (регрессия Casio, TASK-169).
 */
export function turnQualityOf(input: {
  answer: string;
  question: string;
  verification: IAnswerVerification;
  toolResults: readonly IAiToolInvocation[];
  rounds: number;
}): ITurnQuality {
  return {
    numbers: checkedNumbers(input.answer, input.question).length,
    unconfirmed: input.verification.unconfirmed.length,
    toolCalls: input.toolResults.length,
    rounds: input.rounds,
    asksBackNoTools: input.toolResults.length === 0 && asksBack(input.answer),
  };
}
