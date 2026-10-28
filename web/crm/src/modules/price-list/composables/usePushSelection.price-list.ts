import type {
  PushMarketplaceOption,
  StockPushMarketplace,
  StockPushPlan,
} from '../price-list.domain';
import type { Ref } from 'vue';

import { computed, ref, watch } from 'vue';

import { confirmText, marketplaceOptions } from '../mappers/mapStockPush.price-list';

/**
 * Какие площадки записать. По умолчанию отмечены все, куда можно писать: это
 * прежнее поведение кнопки; снять галочку — сузить запись. Новый план (новый
 * прайс, «Обновить») снова отмечает все — выбор относился к прошлым числам.
 */
export function usePushSelection(plan: Readonly<Ref<StockPushPlan | null>>) {
  const selected = ref<Set<StockPushMarketplace>>(new Set());

  const options = computed<PushMarketplaceOption[]>(() =>
    plan.value ? marketplaceOptions(plan.value) : [],
  );

  watch(
    () => plan.value?.planHash,
    () => {
      selected.value = new Set(
        options.value.filter((option) => option.writable).map((option) => option.marketplace),
      );
    },
    { immediate: true },
  );

  function isSelected(marketplace: StockPushMarketplace): boolean {
    return selected.value.has(marketplace);
  }

  function toggle(marketplace: StockPushMarketplace, on: boolean): void {
    const option = options.value.find((item) => item.marketplace === marketplace);
    if (!option?.writable) return;
    const next = new Set(selected.value);
    if (on) next.add(marketplace);
    else next.delete(marketplace);
    selected.value = next;
  }

  const chosen = computed(() =>
    options.value.filter((option) => option.writable && selected.value.has(option.marketplace)),
  );
  const marketplaces = computed(() => chosen.value.map((option) => option.marketplace));
  const count = computed(() => chosen.value.reduce((sum, option) => sum + option.count, 0));
  const confirmDescription = computed(() => confirmText(chosen.value));

  return { options, isSelected, toggle, marketplaces, count, confirmDescription };
}
