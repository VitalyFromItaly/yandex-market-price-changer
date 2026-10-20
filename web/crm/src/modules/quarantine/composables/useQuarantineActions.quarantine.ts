import type { ConfirmTarget } from '../quarantine.domain';
import type { Ref } from 'vue';

import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';

import { confirmSummary } from '../mappers/mapQuarantine.quarantine';
import { useQuarantineStore } from '../store/store.quarantine';

import { toast } from '@/components/ui/toast';

/**
 * Отметки строк, диалог подтверждения и само подтверждение.
 *
 * Отметки живут, пока товар в списке: после перезагрузки ушедшие из карантина
 * снимаются, иначе «Подтвердить выбранные» посчитал бы то, чего на экране нет.
 */
export function useQuarantineActions(storeKey: Ref<string>) {
  const store = useQuarantineStore();
  const { view } = storeToRefs(store);

  const selected = ref<Set<string>>(new Set());
  const target = ref<ConfirmTarget | null>(null);

  const offerIds = computed(() => view.value?.rows.map((row) => row.offerId) ?? []);
  const allSelected = computed(
    () => offerIds.value.length > 0 && offerIds.value.every((id) => selected.value.has(id)),
  );

  watch(offerIds, (ids) => {
    const live = new Set(ids);
    selected.value = new Set([...selected.value].filter((id) => live.has(id)));
  });

  function toggle(offerId: string, on: boolean): void {
    const next = new Set(selected.value);
    if (on) next.add(offerId);
    else next.delete(offerId);
    selected.value = next;
  }

  function toggleAll(on: boolean): void {
    selected.value = on ? new Set(offerIds.value) : new Set();
  }

  function idsOf(what: ConfirmTarget): string[] {
    if (what.kind === 'one') return [what.offerId];
    if (what.kind === 'selected') return offerIds.value.filter((id) => selected.value.has(id));
    return offerIds.value;
  }

  /** Сколько товаров затронет открытый диалог. */
  const targetCount = computed(() => (target.value === null ? 0 : idsOf(target.value).length));

  const dialogOpen = computed({
    get: () => target.value !== null,
    set: (open: boolean) => {
      if (!open) target.value = null;
    },
  });

  function ask(what: ConfirmTarget): void {
    if (idsOf(what).length > 0) target.value = what;
  }

  async function confirm(): Promise<void> {
    if (target.value === null) return;
    const ids = idsOf(target.value);
    const result = await store.confirm(storeKey.value, ids);
    target.value = null;
    if (result === null) return;
    toast.success('Цены подтверждены', confirmSummary(result));
  }

  return {
    selected,
    allSelected,
    toggle,
    toggleAll,
    target,
    targetCount,
    dialogOpen,
    ask,
    confirm,
  };
}
