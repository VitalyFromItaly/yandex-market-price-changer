<script setup lang="ts">
/**
 * Сверка v2 «Финучёта» (TASK-228, API — TASK-226, Ozon/WB — TASK-227): за
 * закрытый месяц площадки — статьи реестра против её документов (ЯМ — акт и
 * поручения, Ozon — сальдо месяца, WB — документа нет), итог «сверено / есть
 * расхождения / недостаточно данных», когда сверено и на какие данные,
 * операции без заказа. Числа, статусы и причины — с сервера; здесь только показ.
 */
import type { AccountingMarketplace } from '../accounting.domain';

import { computed, watch } from 'vue';

import { useReconcileMonth } from '../composables/useReconcileMonth.accounting';
import { mapReconcile } from '../mappers/mapReconcile.accounting';
import { useAccountingStore } from '../store/store.accounting';

import ReconcileDocumentsCard from './ReconcileDocumentsCard.vue';
import ReconcileLinesTable from './ReconcileLinesTable.vue';
import ReconcileMonthPicker from './ReconcileMonthPicker.vue';
import ReconcileStoreLevelCard from './ReconcileStoreLevelCard.vue';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { OptionGroup } from '@/components/ui/option-group';
import { Skeleton } from '@/components/ui/skeleton';

const store = useAccountingStore();
const { month, options, label } = useReconcileMonth();
const view = computed(() => (store.reconcile ? mapReconcile(store.reconcile) : null));
// Ответ выбранного месяца и площадки уже пришёл — иначе скелетон, а не цифры прошлого.
const shown = computed(
  () =>
    store.reconcile?.period.from.slice(0, 7) === month.value &&
    (store.reconcileMarketplace === null ||
      store.reconcile.marketplace === store.reconcileMarketplace),
);
// Выбранная площадка — та, что в ответе; без запроса сервер берёт первую доступную.
const marketplace = computed<AccountingMarketplace | null>({
  get: () => store.reconcileMarketplace ?? store.reconcile?.marketplace ?? null,
  set: (value) => {
    if (value) void store.loadReconcile(month.value, value);
  },
});

watch(month, (value) => void store.loadReconcile(value), { immediate: true });
</script>

<template>
  <section class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 class="text-base font-semibold">{{ view?.title ?? 'Сверка' }}</h2>
        <p v-if="view" class="text-sm text-muted-foreground">{{ view.subtitle }}</p>
      </div>
      <ReconcileMonthPicker
        v-model="month"
        :options="options"
        :label="label"
        :disabled="store.reconcileLoading"
      />
    </div>

    <OptionGroup
      v-if="view && view.marketplaceOptions.length > 1"
      v-model="marketplace"
      :options="view.marketplaceOptions"
      label="Площадка"
      :disabled="store.reconcileLoading"
    />

    <Alert v-if="store.reconcileError">
      Сверка не загрузилась: {{ store.reconcileError }}. Обновите страницу чуть позже.
    </Alert>

    <div v-else-if="!view || !shown" class="flex flex-col gap-3">
      <Skeleton class="h-10" />
      <Skeleton class="h-72" />
    </div>

    <template v-else>
      <div class="flex flex-col gap-1">
        <div class="flex flex-wrap items-center gap-2">
          <Badge :variant="view.tone">{{ view.statusLabel }}</Badge>
          <span class="text-sm text-muted-foreground">{{ view.stampLabel }}</span>
        </div>
        <p v-for="note in view.notes" :key="note" class="text-sm text-warn">{{ note }}</p>
        <p v-if="view.partialNote" class="text-sm text-muted-foreground">{{ view.partialNote }}</p>
      </div>

      <ReconcileLinesTable :rows="view.lines" />
      <ReconcileDocumentsCard
        :rows="view.documents"
        :title="view.documentsTitle"
        :empty="view.documentsEmpty"
      />
      <ReconcileStoreLevelCard
        :rows="view.storeLevel"
        :more="view.storeLevelMore"
        :total-label="view.storeLevelTotalLabel"
        :summary="view.unmatchedLabel"
      />
    </template>
  </section>
</template>
