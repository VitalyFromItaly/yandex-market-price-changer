import type {
  FeedbackDraftTurnResponse,
  FeedbackView,
  FeedbackViewResponse,
} from '../feedback.domain';

import { mapFeedbackView } from '../mappers/mapFeedback.feedback';

import { http } from '@/shared/http';

const BASE = '/ym/feedback';

export const feedbackApi = {
  /** Отзывы без ответа в кабинете открытого магазина: ключ — в query. */
  list: async (store: string): Promise<FeedbackView> =>
    mapFeedbackView(
      await http.get<FeedbackViewResponse>(`${BASE}?store=${encodeURIComponent(store)}`),
    ),

  /** ЗАПИСЬ в Маркет: публичный ответ. Зовётся только из шага превью. */
  reply: async (store: string, feedbackId: number, text: string): Promise<void> => {
    await http.post(`${BASE}/reply`, { store, feedbackId, text });
  },

  /** «✨ Предложить ответ»: ход ИИ в памяти сервера. НЕ запись — только черновик. */
  draftStart: async (store: string, feedbackId: number): Promise<string> =>
    (await http.post<{ turnId: string }>(`${BASE}/draft/turns`, { store, feedbackId })).turnId,

  draftTurn: (turnId: string): Promise<FeedbackDraftTurnResponse> =>
    http.get<FeedbackDraftTurnResponse>(`${BASE}/draft/turns/${encodeURIComponent(turnId)}`),

  /** ЗАПИСЬ в Маркет: отзыв помечается прочитанным без ответа. */
  skip: async (store: string, feedbackId: number): Promise<void> => {
    await http.post(`${BASE}/skip`, { store, feedbackId });
  },
};
