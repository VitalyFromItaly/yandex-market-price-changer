import type { AiAnalystTabMeta } from '../ai-analyst.domain';

import { computed } from 'vue';

import { AI_ANALYST_ROUTE_NAME, AI_ANALYST_TABS } from '../ai-analyst.domain';

import { useAuthStore } from '@/modules/auth/store/store.auth';
import { useRouteTabs } from '@/shared/composables';

/**
 * Вкладки, открытые продавцу (TASK-150). Раздел открывает любая из двух фич,
 * а у каждой вкладки — своя: закрытая вела бы в 403.
 */
export function openAiAnalystTabs(
  features: Record<string, boolean> | undefined,
): AiAnalystTabMeta[] {
  return AI_ANALYST_TABS.filter((tab) => features?.[tab.feature] === true);
}

/** Вкладка — в URL (`/ym/ai-analyst/:tab?`): F5 возвращает в ту же. */
export function useAiAnalystTabs() {
  const auth = useAuthStore();
  const open = computed(() => openAiAnalystTabs(auth.me?.features));
  return { open, ...useRouteTabs(AI_ANALYST_ROUTE_NAME, 'tab', open) };
}
