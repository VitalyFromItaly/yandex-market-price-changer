<script setup lang="ts">
/**
 * «Загрузить из Маркета» на экранах с несколькими площадками («Сравнение
 * площадок», «Дашборд площадок»): баннер на каждую открытую площадку, у которой
 * журнал периода не загружен. Закрытая площадка (`closed`) не спрашивается.
 */
import type { JournalMarketplace } from './financeJournal.domain';

import JournalPull from './JournalPull.vue';
import { useFinanceJournal } from './useFinanceJournal';

const props = defineProps<{
  columns: readonly { marketplace: JournalMarketplace; label: string; state: string }[];
  range: { from: string; to: string } | null;
}>();
const emit = defineEmits<{ loaded: [] }>();

const sourceOf = (marketplace: JournalMarketplace) => () => {
  const column = props.columns.find((c) => c.marketplace === marketplace);
  return column && column.state !== 'closed' && props.range
    ? { marketplace, ...props.range }
    : null;
};

const MARKETPLACES: JournalMarketplace[] = ['ym', 'ozon', 'wb'];
const journals = MARKETPLACES.map((marketplace) => ({
  marketplace,
  journal: useFinanceJournal(sourceOf(marketplace), () => emit('loaded')),
}));

const labelOf = (marketplace: JournalMarketplace) =>
  props.columns.find((c) => c.marketplace === marketplace)?.label ?? marketplace;
</script>

<template>
  <JournalPull
    v-for="j in journals"
    :key="j.marketplace"
    :journal="j.journal"
    :label="labelOf(j.marketplace)"
    only-missing
  />
</template>
