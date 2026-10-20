import type { AnswerRating, PeriodReviewModel, ReviewTurnResponse } from '../../ai-analyst.domain';

import { ref } from 'vue';

import { periodReviewApi } from '../../api/periodReviewApi.ai-analyst';
import { toReviewModel } from '../../mappers/mapReview.ai-analyst';

import { useTurn } from '@/shared/composables/useTurn';
import { recentMonths } from '@/shared/period';
import { moscowToday } from '@/shared/utils';

/**
 * Разбор месяца (TASK-150): кнопка «Разобрать период» → ход в памяти сервера →
 * опрос. Месяц по умолчанию — прошлый.
 * Разбор не кэшируется — это текст модели о данных продавца (правило TASK-104).
 */
/** Прошлый месяц: «Проверено» бывает только у закрытого. */
const defaultMonth = (): string => recentMonths(moscowToday(), 2)[1] ?? '';

/**
 * Поля — с префиксом `review`: слайс живёт в одном сторе с чатом, а у того
 * свои `pending`, `error` и `reset`.
 */
export function usePeriodReview() {
  const month = ref(defaultMonth());
  const review = ref<PeriodReviewModel | null>(null);
  const pending = ref(false);
  const error = ref<string | null>(null);
  /** id хода разбора и оценка 👍/👎 (TASK-170). */
  const turnId = ref<string | null>(null);
  const rating = ref<AnswerRating | null>(null);
  const turn = useTurn<ReviewTurnResponse>((id) => periodReviewApi.turn(id));

  async function run(): Promise<void> {
    if (pending.value) return;
    const asked = month.value;
    error.value = null;
    review.value = null;
    turnId.value = null;
    rating.value = null;
    pending.value = true;
    try {
      const result = await turn.run(() => periodReviewApi.start(asked));
      if (result === null) return;
      if (result.status === 'done' && result.answer) {
        review.value = toReviewModel(result.answer);
        turnId.value = turn.lastTurnId();
      } else error.value = result.message ?? 'Не удалось разобрать период — попробуйте ещё раз.';
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Не удалось разобрать период';
    } finally {
      pending.value = false;
    }
  }

  /** Оценка разбора: оптимистично, при отказе — прежняя и текст ошибки. */
  async function rate(value: AnswerRating): Promise<void> {
    const id = turnId.value;
    if (!id || rating.value === value) return;
    const before = rating.value;
    rating.value = value;
    try {
      await periodReviewApi.rate(id, value);
    } catch {
      rating.value = before;
      error.value = 'Не удалось сохранить оценку — попробуйте ещё раз';
    }
  }

  function selectMonth(value: string): void {
    if (pending.value || value === month.value) return;
    month.value = value;
    review.value = null;
    turnId.value = null;
    rating.value = null;
    error.value = null;
  }

  function reset(): void {
    turn.cancel();
    month.value = defaultMonth();
    review.value = null;
    turnId.value = null;
    rating.value = null;
    pending.value = false;
    error.value = null;
  }

  return {
    reviewMonth: month,
    review,
    reviewPending: pending,
    reviewError: error,
    reviewRating: rating,
    rateReview: rate,
    runReview: run,
    selectReviewMonth: selectMonth,
    resetReview: reset,
  };
}
