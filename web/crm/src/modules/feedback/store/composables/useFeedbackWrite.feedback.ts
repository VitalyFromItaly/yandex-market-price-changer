import type { FeedbackWriteResult } from '../../feedback.domain';

import { ref } from 'vue';

import { feedbackApi } from '../../api/feedbackApi.feedback';
import { FEEDBACK_GONE } from '../../feedback.domain';

import { ApiError } from '@/shared/http';

/**
 * Ответ и «Пропустить» — записи в Маркет. После ЛЮБОГО исхода список
 * перезапрашивается: обработанный отзыв уходит из него, а при 409 он уже ушёл
 * по чужой руке. Ошибка возвращается итогом, а не ref'ом: её показывает тот
 * диалог, из которого пришла запись, и текст ответа в нём остаётся.
 */
export function useFeedbackWrite(reload: (store: string) => Promise<void>) {
  const isWriting = ref(false);

  async function write(store: string, action: () => Promise<void>): Promise<FeedbackWriteResult> {
    isWriting.value = true;
    try {
      await action();
      return { ok: true };
    } catch (caught) {
      const api = caught instanceof ApiError ? caught : null;
      return {
        ok: false,
        message: caught instanceof Error ? caught.message : 'Маркет не принял запрос',
        gone: api?.code === FEEDBACK_GONE,
        field: api?.field ?? null,
      };
    } finally {
      isWriting.value = false;
      await reload(store);
    }
  }

  function reply(store: string, feedbackId: number, text: string): Promise<FeedbackWriteResult> {
    return write(store, () => feedbackApi.reply(store, feedbackId, text));
  }

  function skip(store: string, feedbackId: number): Promise<FeedbackWriteResult> {
    return write(store, () => feedbackApi.skip(store, feedbackId));
  }

  function reset(): void {
    isWriting.value = false;
  }

  return { isWriting, reply, skip, reset };
}
