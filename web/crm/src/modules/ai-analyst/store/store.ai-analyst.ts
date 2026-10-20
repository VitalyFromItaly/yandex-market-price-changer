import { defineStore } from 'pinia';

import { useChat } from './composables/useChat.ai-analyst';
import { usePeriodReview } from './composables/usePeriodReview.ai-analyst';

import { useArticleOperations } from '@/shared/finance-operations';

/**
 * Стор «ИИ-аналитика» — фасад: лента чата, разбор периода (TASK-150) и раскрытие ссылки ответа до
 * операций журнала (то же раскрытие, что у статьи «Финансов»).
 */
export const useAiAnalystStore = defineStore('ai-analyst', () => {
  const chat = useChat();
  const periodReview = usePeriodReview();
  const operations = useArticleOperations();
  return {
    ...chat,
    ...periodReview,
    ...operations,
    // Общий reset — последним, перекрывает reset слайсов.
    reset() {
      chat.reset();
      periodReview.resetReview();
      operations.reset();
    },
  };
});
