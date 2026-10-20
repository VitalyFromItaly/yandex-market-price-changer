import type { useFeedbackReply } from './useFeedbackReply.feedback';
import type { FeedbackDraftTurnResponse } from '../feedback.domain';
import type { Ref } from 'vue';

import { ref, watch } from 'vue';

import { feedbackApi } from '../api/feedbackApi.feedback';

import { toast } from '@/components/ui/toast';
import { useTurn } from '@/shared/composables/useTurn';

const DRAFT_FAILED_TEXT = 'Не удалось предложить ответ — попробуйте ещё раз или напишите сами.';

/**
 * «✨ Предложить ответ» (TASK-167): черновик ИИ ложится в поле ответа открытого
 * отзыва — и только. Наружу он уходит прежним путём: превью → «Опубликовать»,
 * отсюда ничего не публикуется.
 *
 * Ход — в памяти сервера, опрос — общий `useTurn`. Длинный или пустой черновик
 * не обрезается: текст в поле, причина — ошибкой под ним. Отзыв успели
 * обработать — диалог закрывается, как при 409 на публикации. Смена отзыва
 * или закрытие диалога отменяют ожидание: поздний черновик не ляжет не туда.
 */
export function useFeedbackDraft(
  storeKey: Ref<string>,
  reply: ReturnType<typeof useFeedbackReply>,
) {
  const suggesting = ref(false);
  const turn = useTurn<FeedbackDraftTurnResponse>((id) => feedbackApi.draftTurn(id));

  // flush 'sync': отложенный наблюдатель сработал бы ПОСЛЕ suggest() и отменил
  // бы только что начатый ход открытого отзыва.
  watch(
    reply.openId,
    () => {
      turn.cancel();
      suggesting.value = false;
    },
    { flush: 'sync' },
  );

  async function suggest(): Promise<void> {
    const feedbackId = reply.openId.value;
    if (feedbackId === null || suggesting.value) return;
    suggesting.value = true;
    reply.error.value = null;
    try {
      const result = await turn.run(() => feedbackApi.draftStart(storeKey.value, feedbackId));
      if (result === null) return;
      const answer = result.status === 'done' ? result.answer : undefined;
      if (!answer) {
        reply.error.value = result.message ?? DRAFT_FAILED_TEXT;
        return;
      }
      if (answer.gone) {
        reply.openId.value = null;
        toast.info('Отзыв уже обработан', answer.message ?? undefined);
        return;
      }
      reply.text.value = answer.text;
      // После текста: сеттер поля снимает ошибку, а причина должна остаться видна.
      reply.error.value = answer.message;
    } catch (e) {
      reply.error.value = e instanceof Error ? e.message : DRAFT_FAILED_TEXT;
    } finally {
      suggesting.value = false;
    }
  }

  return { suggesting, suggest };
}
