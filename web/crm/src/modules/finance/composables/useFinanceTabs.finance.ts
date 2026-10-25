import type { FinanceMarketplace, FinanceTabMeta } from '../finance.domain';
import type { Ref } from 'vue';

import { computed } from 'vue';

import { FINANCE_TABS } from '../constants/tabs.finance';

import { useAuthStore } from '@/modules/auth/store/store.auth';
import { sectionName } from '@/navigation.sections';
import { useRouteTabs } from '@/shared/composables';

/**
 * Вкладки, открытые продавцу. Раздел открывает `finance`; у вкладки со своей
 * фичей (`anomalies`) — ещё она: закрытая вела бы в 403. Загрузка файлом —
 * только отчёт ЯМ по платежам, у Ozon/WB вкладки нет (TASK-180).
 */
export function openFinanceTabs(
  features: Record<string, boolean> | undefined,
  marketplace: FinanceMarketplace = 'ym',
): FinanceTabMeta[] {
  return FINANCE_TABS.filter(
    (tab) =>
      (!tab.feature || features?.[tab.feature] === true) &&
      (tab.key !== 'upload' || marketplace === 'ym'),
  );
}

/** Вкладка — в URL (`/<площадка>/finance/:tab?`): F5 возвращает в ту же. */
export function useFinanceTabs(marketplace: Readonly<Ref<FinanceMarketplace>>) {
  const auth = useAuthStore();
  const open = computed(() => openFinanceTabs(auth.me?.features, marketplace.value));
  const routeName = () => sectionName(marketplace.value, 'finance');
  return { open, ...useRouteTabs(routeName, 'tab', open) };
}
