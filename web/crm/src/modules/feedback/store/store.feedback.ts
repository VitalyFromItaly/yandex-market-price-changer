import { defineStore } from 'pinia';

import { useFeedbackList } from './composables/useFeedbackList.feedback';
import { useFeedbackWrite } from './composables/useFeedbackWrite.feedback';

/** Стор «Отзывов» — фасад: список и записи (ответ, пропуск), перезагружающие список. */
export const useFeedbackStore = defineStore('feedback', () => {
  const list = useFeedbackList();
  const writing = useFeedbackWrite(list.load);

  return {
    view: list.view,
    isLoading: list.isLoading,
    isRefreshing: list.isRefreshing,
    savedAt: list.savedAt,
    loadError: list.error,
    load: list.load,

    isWriting: writing.isWriting,
    reply: writing.reply,
    skip: writing.skip,

    reset() {
      list.reset();
      writing.reset();
    },
  };
});
