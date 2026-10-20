import type { AnswerRating, ReviewTurnResponse } from '../ai-analyst.domain';

import { http } from '@/shared/http';

const BASE = '/ym/ai-analyst/review';

/** Разбор месяца (TASK-150): старт отдаёт id, разбор забирается опросом (ход в памяти сервера). */
export const periodReviewApi = {
  start: async (month: string): Promise<string> =>
    (await http.post<{ turnId: string }>(`${BASE}/turns`, { month })).turnId,

  turn: (turnId: string): Promise<ReviewTurnResponse> =>
    http.get<ReviewTurnResponse>(`${BASE}/turns/${encodeURIComponent(turnId)}`),

  /** 👍/👎 (TASK-170): хранится только оценка; повтор заменяет прежнюю. */
  rate: async (turnId: string, rating: AnswerRating): Promise<void> => {
    await http.post(`${BASE}/turns/${encodeURIComponent(turnId)}/rating`, { rating });
  },
};
