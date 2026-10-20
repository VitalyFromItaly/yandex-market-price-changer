import type { Ref } from 'vue';

import { computed, ref } from 'vue';

import { useFeedbackStore } from '../store/store.feedback';

import { toast } from '@/components/ui/toast';

/**
 * «Пропустить»: отзыв помечается прочитанным без ответа. Это запись в Маркет —
 * только через диалог подтверждения.
 */
export function useFeedbackSkip(storeKey: Ref<string>) {
  const store = useFeedbackStore();
  const target = ref<number | null>(null);

  const dialogOpen = computed({
    get: () => target.value !== null,
    set: (isOpen: boolean) => {
      if (!isOpen && !store.isWriting) target.value = null;
    },
  });

  function ask(feedbackId: number): void {
    target.value = feedbackId;
  }

  async function confirm(): Promise<void> {
    const feedbackId = target.value;
    if (feedbackId === null || store.isWriting) return;
    const result = await store.skip(storeKey.value, feedbackId);
    target.value = null;
    if (result.ok) toast.success('Отзыв пропущен', 'Он больше не ждёт ответа.');
    else if (result.gone) toast.info('Отзыв уже обработан', result.message);
    else toast.error('Не удалось пропустить отзыв', result.message);
  }

  return { target, dialogOpen, ask, confirm };
}
