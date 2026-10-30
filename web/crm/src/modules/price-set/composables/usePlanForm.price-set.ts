import type { MarkupRow, PriceSetMarketplace, PriceSetMode } from '../price-set.domain';

import { computed, ref, watch } from 'vue';

import { markupRowError, markupsOf } from '../mappers/mapPriceSet.price-set';
import {
  MARKETPLACE_LABEL,
  PRICE_SET_MARKETPLACES,
  PURCHASE_PRICES_FEATURE,
} from '../price-set.domain';

import { useAuthStore } from '@/modules/auth/store/store.auth';

/** Площадки продавца: ЯМ — всегда, Ozon и WB — когда открыты их фичи. */
export function openMarketplacesOf(
  features: Record<string, boolean> | undefined,
): PriceSetMarketplace[] {
  return PRICE_SET_MARKETPLACES.filter((mp) => mp === 'ym' || features?.[mp] === true);
}

/**
 * Ввод плана: способ, наценка по площадке, файл и его площадки. Наценка — только
 * при открытом закупе из прайса (без него закупа нет, сервер откажет): тогда
 * способ один — файл. По умолчанию отмечен Маркет.
 */
export function usePlanForm() {
  const auth = useAuthStore();
  const marketplaces = computed(() => openMarketplacesOf(auth.me?.features));
  const markupOpen = computed(() => auth.me?.features[PURCHASE_PRICES_FEATURE] === true);

  const chosenMode = ref<PriceSetMode>('markup');
  const mode = computed<PriceSetMode>(() => (markupOpen.value ? chosenMode.value : 'file'));

  const rows = ref<MarkupRow[]>([]);
  const fileMarketplaces = ref<Set<PriceSetMarketplace>>(new Set(['ym']));
  const file = ref<File | null>(null);
  /** Пытались отправить — ошибки строк видны только после этого. */
  const touched = ref(false);

  watch(
    marketplaces,
    (list) => {
      rows.value = list.map(
        (mp) =>
          rows.value.find((row) => row.marketplace === mp) ?? {
            marketplace: mp,
            label: MARKETPLACE_LABEL[mp],
            on: mp === 'ym',
            text: '',
          },
      );
    },
    { immediate: true },
  );

  function setMode(next: PriceSetMode): void {
    chosenMode.value = next;
  }

  function setRow(
    marketplace: PriceSetMarketplace,
    patch: Partial<Pick<MarkupRow, 'on' | 'text'>>,
  ): void {
    rows.value = rows.value.map((row) =>
      row.marketplace === marketplace ? { ...row, ...patch } : row,
    );
  }

  function toggleFileMarketplace(marketplace: PriceSetMarketplace, on: boolean): void {
    const next = new Set(fileMarketplaces.value);
    if (on) next.add(marketplace);
    else next.delete(marketplace);
    fileMarketplaces.value = next;
  }

  const markups = computed(() => markupsOf(rows.value));
  const rowErrors = computed(
    () =>
      Object.fromEntries(
        rows.value.map((row) => [row.marketplace, touched.value ? markupRowError(row) : null]),
      ) as Partial<Record<PriceSetMarketplace, string | null>>,
  );
  const chosenFileMarketplaces = computed(() =>
    marketplaces.value.filter((mp) => fileMarketplaces.value.has(mp)),
  );

  /** Можно считать: наценка — все отмеченные строки верны и есть хоть одна; файл — файл и площадка. */
  const canSubmit = computed(() => {
    if (mode.value === 'file')
      return file.value !== null && chosenFileMarketplaces.value.length > 0;
    const on = rows.value.filter((row) => row.on);
    return on.length > 0 && on.every((row) => markupRowError(row) === null);
  });

  function touch(): void {
    touched.value = true;
  }

  return {
    marketplaces,
    markupOpen,
    mode,
    setMode,
    rows,
    setRow,
    rowErrors,
    markups,
    file,
    fileMarketplaces: chosenFileMarketplaces,
    toggleFileMarketplace,
    canSubmit,
    touch,
  };
}
