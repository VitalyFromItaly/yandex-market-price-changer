import type { AnswerRating, HistoryMessage, TurnResponse } from '../ai-analyst.domain';

import { http } from '@/shared/http';

const BASE = '/ym/ai-analyst';

/** Ход чата: старт отдаёт id, ответ забирается опросом (ход идёт в памяти сервера). */
export const aiAnalystApi = {
  start: async (messages: readonly HistoryMessage[]): Promise<string> =>
    (await http.post<{ turnId: string }>(`${BASE}/turns`, { messages })).turnId,

  turn: (turnId: string): Promise<TurnResponse> =>
    http.get<TurnResponse>(`${BASE}/turns/${encodeURIComponent(turnId)}`),

  /** 👍/👎 (TASK-170): хранится только оценка; повтор заменяет прежнюю. */
  rate: async (turnId: string, rating: AnswerRating): Promise<void> => {
    await http.post(`${BASE}/turns/${encodeURIComponent(turnId)}/rating`, { rating });
  },
};
