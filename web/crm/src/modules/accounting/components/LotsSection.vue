<script setup lang="ts">
/**
 * Партии и режим себестоимости «Финучёта» (TASK-216) под `fin_accounting_lots`:
 * переключатель А/Б и партии закупок с остатками. Остаток — FIFO сервера по
 * продажам всех площадок (склад один), здесь только показ.
 */
import { Boxes } from 'lucide-vue-next';
import { computed, onMounted } from 'vue';

import { mapAccountingLots } from '../mappers/mapAccountingLots.accounting';
import { useAccountingStore } from '../store/store.accounting';

import CostMethodCard from './CostMethodCard.vue';
import LotsTable from './LotsTable.vue';

import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

const store = useAccountingStore();
const view = computed(() => (store.lots ? mapAccountingLots(store.lots) : null));

onMounted(() => void store.loadLots());
</script>

<template>
  <section class="flex flex-col gap-3">
    <div>
      <h2 class="text-base font-semibold">Партии и остатки</h2>
      <p class="text-sm text-muted-foreground">
        Каждая строка закупки — партия. Продажи списывают партии по порядку поступления (FIFO),
        пригодный возврат кладёт товар обратно.
      </p>
    </div>

    <CostMethodCard />

    <Alert v-if="store.lotsError">
      Партии не загрузились: {{ store.lotsError }}. Обновите страницу чуть позже.
    </Alert>
    <Skeleton v-else-if="!view" class="h-48" />
    <EmptyState
      v-else-if="!view.rows.length"
      :icon="Boxes"
      title="Партий пока нет"
      description="Заведите закупку с позициями в разделе «Закупки» — каждая позиция станет партией."
    />
    <template v-else>
      <p class="text-sm text-muted-foreground">{{ view.totalsLabel }}</p>
      <LotsTable :rows="view.rows" />
    </template>
  </section>
</template>
