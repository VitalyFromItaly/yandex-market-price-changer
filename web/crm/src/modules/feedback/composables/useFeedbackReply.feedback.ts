import type { Ref } from 'vue';

import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';

import { useFeedbackStore } from '../store/store.feedback';

import { toast } from '@/components/ui/toast';

export type ReplyStep = 'edit' | 'preview';

/** Текст ответа нельзя публиковать — почему; иначе null. Та же проверка, что на сервере. */
export function replyTextError(text: string, maxLength: number): string | null {
  if (!text.trim()) return 'Напишите текст ответа.';
  if (text.length > maxLength) {
    return `Ответ длиннее ${maxLength} символов — сократите на ${text.length - maxLength}.`;
  }
  return null;
}

/**
 * Диалог ответа на отзыв: поле → превью → «Опубликовать».
 *
 * Ответ публичный, поэтому наружу текст уходит только из шага превью. Черновики
 * живут здесь, по отзыву: закрыли диалог или Маркет не принял ответ — текст на
 * месте. Черновики ушедших из списка отзывов снимаются при перезагрузке.
 */
export function useFeedbackReply(storeKey: Ref<string>) {
  const store = useFeedbackStore();
  const { view, isWriting } = storeToRefs(store);

  const drafts = ref<Map<number, string>>(new Map());
  const openId = ref<number | null>(null);
  const step = ref<ReplyStep>('edit');
  /** Ошибка под полем (шаг правки) или над превью (отказ Маркета). */
  const error = ref<string | null>(null);

  const maxLength = computed(() => view.value?.replyMaxLength ?? 0);
  const row = computed(
    () => view.value?.rows.find((item) => item.feedbackId === openId.value) ?? null,
  );

  watch(
    () => view.value?.rows.map((item) => item.feedbackId) ?? [],
    (ids) => {
      const live = new Set(ids);
      drafts.value = new Map([...drafts.value].filter(([id]) => live.has(id)));
      if (openId.value !== null && !live.has(openId.value)) openId.value = null;
    },
  );

  const text = computed({
    get: () => (openId.value === null ? '' : (drafts.value.get(openId.value) ?? '')),
    set: (value: string) => {
      if (openId.value === null) return;
      drafts.value = new Map(drafts.value).set(openId.value, value);
      // Сообщение «слишком длинно» не должно висеть, когда продавец уже сократил.
      if (error.value !== null && step.value === 'edit') {
        error.value =
          value.length > maxLength.value ? replyTextError(value, maxLength.value) : null;
      }
    },
  });

  const dialogOpen = computed({
    get: () => openId.value !== null,
    set: (isOpen: boolean) => {
      if (!isOpen && !isWriting.value) openId.value = null;
    },
  });

  function hasDraft(feedbackId: number): boolean {
    return (drafts.value.get(feedbackId) ?? '').trim() !== '';
  }

  function open(feedbackId: number): void {
    openId.value = feedbackId;
    step.value = 'edit';
    error.value = null;
  }

  function preview(): void {
    error.value = replyTextError(text.value, maxLength.value);
    if (error.value === null) step.value = 'preview';
  }

  function back(): void {
    step.value = 'edit';
    error.value = null;
  }

  async function publish(): Promise<void> {
    const feedbackId = openId.value;
    if (feedbackId === null || step.value !== 'preview' || isWriting.value) return;

    const result = await store.reply(storeKey.value, feedbackId, text.value);
    if (result.ok) {
      drafts.value.delete(feedbackId);
      openId.value = null;
      toast.success('Ответ опубликован', 'Его видят покупатели на Яндекс.Маркете.');
      return;
    }
    if (result.gone) {
      openId.value = null;
      toast.info('Отзыв уже обработан', result.message);
      return;
    }
    // Текст остаётся в форме: переотправить можно, не набирая заново.
    error.value = result.message;
    if (result.field === 'text') step.value = 'edit';
  }

  return {
    openId,
    row,
    step,
    text,
    error,
    maxLength,
    dialogOpen,
    hasDraft,
    open,
    preview,
    back,
    publish,
  };
}
