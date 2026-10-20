import type { DashboardPeriodKey, SourceKey } from '../dashboard.domain';

import { defineStore } from 'pinia';
import { ref } from 'vue';

import { DEFAULT_DASHBOARD_PERIOD, SOURCE, SOURCES, sourcePeriod } from '../dashboard.domain';

import { usePriceListInfo } from './composables/usePriceListInfo.dashboard';
import { useSourceJob } from './composables/useSourceJob.dashboard';

type Source = ReturnType<typeof useSourceJob>;

/** Стор главной — тонкий фасад: источник на задачу, общий период и дата прайса. */
export const useDashboardStore = defineStore('dashboard', () => {
  const sources = Object.fromEntries(
    SOURCES.map((meta) => [meta.key, useSourceJob(meta)]),
  ) as Record<SourceKey, Source>;
  const priceList = usePriceListInfo();
  const period = ref<DashboardPeriodKey>(DEFAULT_DASHBOARD_PERIOD);

  function start(keys: readonly SourceKey[], store: string): void {
    for (const meta of SOURCES) {
      if (keys.includes(meta.key))
        void sources[meta.key].load(store, sourcePeriod(meta, period.value));
    }
  }

  /**
   * Запустить открытые источники — каждый своей задачей, не дожидаясь соседних.
   * Закрытый источник задачу не ставит: гейт ответил бы 403.
   */
  function load(open: readonly SourceKey[], store: string): void {
    start(open, store);
    void priceList.load();
  }

  /**
   * Сменить общий период: перезапускаются только источники, которые от него
   * зависят. Срезы «сейчас» (в пути, возвраты, остатки) не трогаем.
   */
  function setPeriod(next: DashboardPeriodKey, open: readonly SourceKey[], store: string): void {
    if (next === period.value) return;
    period.value = next;
    const dependent = SOURCES.filter((meta) => meta.period === 'dashboard').map((meta) => meta.key);
    start(
      open.filter((key) => dependent.includes(key)),
      store,
    );
  }

  return {
    sources,
    priceList,
    period,
    load,
    setPeriod,
    reset() {
      for (const key of Object.values(SOURCE)) sources[key].reset();
      priceList.reset();
      period.value = DEFAULT_DASHBOARD_PERIOD;
    },
  };
});
