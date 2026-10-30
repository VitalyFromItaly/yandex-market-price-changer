import type { PriceSetMarketplace, PriceSetPlan } from '../price-set.domain';
import type { Ref } from 'vue';

import { computed, ref, watch } from 'vue';

import { confirmText, defaultExcluded, targetCount } from '../mappers/mapPriceSet.price-set';

/** Строка выбора «куда записать» (MarketplacePicker). */
export interface PriceSetPickerOption {
  marketplace: PriceSetMarketplace;
  label: string;
  writable: boolean;
  note: string;
}

/**
 * Что записать: площадки (по умолчанию все, куда сервер разрешил запись) и
 * снятые строки (по умолчанию — рискованные). Новый план снова ставит
 * умолчания — выбор относился к прошлым цифрам. Сколько строк уйдёт — вычитание
 * снятых из изменений сервера, не пересчёт плана.
 */
export function usePriceSetSelection(plan: Readonly<Ref<PriceSetPlan | null>>) {
  const selected = ref<Set<PriceSetMarketplace>>(new Set());
  const excluded = ref<Set<string>>(new Set());

  watch(
    () => plan.value?.planHash,
    () => {
      const current = plan.value;
      excluded.value = current ? defaultExcluded(current) : new Set();
      selected.value = new Set(
        (current?.targets ?? []).filter((t) => t.willWrite).map((t) => t.marketplace),
      );
    },
    { immediate: true },
  );

  function countOf(marketplace: PriceSetMarketplace): number {
    const target = plan.value?.targets.find((t) => t.marketplace === marketplace);
    return target ? targetCount(target, excluded.value) : 0;
  }

  const options = computed<PriceSetPickerOption[]>(() =>
    (plan.value?.targets ?? []).map((target) => {
      const count = countOf(target.marketplace);
      let note = 'только просмотр — запись открывает администратор';
      if (target.willWrite) note = `запишем ${count} поз.`;
      else if (target.blockedBy !== null) note = 'не пишется — см. ниже';
      else if (target.updates.length === 0) note = 'цены совпадают';
      return {
        marketplace: target.marketplace,
        label: target.marketplaceLabel,
        writable: target.willWrite,
        note,
      };
    }),
  );

  function isSelected(marketplace: PriceSetMarketplace): boolean {
    return selected.value.has(marketplace);
  }

  function toggle(marketplace: PriceSetMarketplace, on: boolean): void {
    if (!options.value.find((o) => o.marketplace === marketplace)?.writable) return;
    const next = new Set(selected.value);
    if (on) next.add(marketplace);
    else next.delete(marketplace);
    selected.value = next;
  }

  function isIncluded(key: string): boolean {
    return !excluded.value.has(key);
  }

  function toggleRow(key: string, on: boolean): void {
    const next = new Set(excluded.value);
    if (on) next.delete(key);
    else next.add(key);
    excluded.value = next;
  }

  const parts = computed(() =>
    options.value
      .filter((o) => o.writable && selected.value.has(o.marketplace))
      .map((o) => ({ marketplace: o.marketplace, count: countOf(o.marketplace) }))
      .filter((part) => part.count > 0),
  );
  const marketplaces = computed(() => parts.value.map((part) => part.marketplace));
  const count = computed(() => parts.value.reduce((sum, part) => sum + part.count, 0));
  const confirmDescription = computed(() => confirmText(parts.value));
  const excludedKeys = computed(() => [...excluded.value]);

  return {
    options,
    isSelected,
    toggle,
    isIncluded,
    toggleRow,
    countOf,
    marketplaces,
    count,
    excludedKeys,
    confirmDescription,
  };
}
