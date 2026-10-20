import type { AnswerRating, ChatMessage, TurnResponse } from '../../ai-analyst.domain';

import { ref } from 'vue';

import { MAX_QUESTION_CHARS } from '../../ai-analyst.domain';
import { aiAnalystApi } from '../../api/aiAnalystApi.ai-analyst';
import { toAnswerModel, toHistory } from '../../mappers/mapAnswer.ai-analyst';

import { useTurn } from '@/shared/composables/useTurn';

/**
 * Лента чата. Живёт только в памяти вкладки: на сервере переписка не хранится
 * (правило TASK-104), и F5 её стирает — это обещано на экране. Пока ход идёт,
 * отправка закрыта: сервер держит один ход на продавца. На ошибке вопрос
 * возвращается в поле ввода — переспросить, не набирая заново.
 */
export function useChat() {
  const messages = ref<ChatMessage[]>([]);
  const draft = ref('');
  const pending = ref(false);
  const error = ref<string | null>(null);
  const turn = useTurn<TurnResponse>((id) => aiAnalystApi.turn(id));
  let nextId = 1;

  async function send(text: string = draft.value): Promise<void> {
    const question = text.trim();
    if (!question || pending.value) return;
    if (question.length > MAX_QUESTION_CHARS) {
      error.value = `Вопрос длиннее ${MAX_QUESTION_CHARS} символов — сократите его`;
      return;
    }
    error.value = null;
    const asked: ChatMessage = { id: nextId++, role: 'user', content: question };
    messages.value = [...messages.value, asked];
    draft.value = '';
    pending.value = true;
    try {
      const history = toHistory(messages.value);
      const result = await turn.run(() => aiAnalystApi.start(history));
      if (result === null) return;
      if (result.status === 'done' && result.answer) {
        const answer = toAnswerModel(result.answer);
        messages.value = [
          ...messages.value,
          {
            id: nextId++,
            role: 'assistant',
            content: answer.text,
            answer,
            turnId: turn.lastTurnId() ?? undefined,
            rating: null,
          },
        ];
      } else {
        fail(asked, result.message ?? 'Не удалось получить ответ — попробуйте ещё раз.');
      }
    } catch (e) {
      fail(asked, e instanceof Error ? e.message : 'Не удалось получить ответ');
    } finally {
      pending.value = false;
    }
  }

  /** Неотвеченный вопрос уходит из ленты обратно в поле ввода. */
  function fail(asked: ChatMessage, message: string): void {
    messages.value = messages.value.filter((m) => m.id !== asked.id);
    if (!draft.value) draft.value = asked.content;
    error.value = message;
  }

  function patch(id: number, rating: AnswerRating | null): void {
    messages.value = messages.value.map((m) => (m.id === id ? { ...m, rating } : m));
  }

  /** 👍/👎 под ответом: сразу на экране, при отказе сервера — прежняя оценка и текст ошибки. */
  async function rate(id: number, rating: AnswerRating): Promise<void> {
    const message = messages.value.find((m) => m.id === id);
    if (!message?.turnId || message.rating === rating) return;
    const before = message.rating ?? null;
    patch(id, rating);
    try {
      await aiAnalystApi.rate(message.turnId, rating);
    } catch {
      patch(id, before);
      error.value = 'Не удалось сохранить оценку — попробуйте ещё раз';
    }
  }

  function reset(): void {
    turn.cancel();
    messages.value = [];
    draft.value = '';
    pending.value = false;
    error.value = null;
  }

  return { messages, draft, pending, error, send, rate, reset };
}
