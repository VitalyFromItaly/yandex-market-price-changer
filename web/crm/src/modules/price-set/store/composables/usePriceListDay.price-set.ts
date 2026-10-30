import { ref } from 'vue';

import { priceListApi } from '@/modules/price-list/api/priceListApi.price-list';

/**
 * Дата последнего прайса с закупом — под формой наценки, ещё до первого плана.
 * Тот же ответ, что у «Закупочных цен» на «Прайсе» (`lastUpdated`); сбой не
 * мешает странице — подпись просто останется общей.
 */
export function usePriceListDay() {
  const day = ref<string | null>(null);
  let loaded = false;

  async function ensure(): Promise<void> {
    if (loaded) return;
    loaded = true;
    try {
      day.value = (await priceListApi.purchasePrices({ q: '', page: 1 })).lastUpdated;
    } catch {
      loaded = false;
    }
  }

  function reset(): void {
    day.value = null;
    loaded = false;
  }

  return { day, ensure, reset };
}
