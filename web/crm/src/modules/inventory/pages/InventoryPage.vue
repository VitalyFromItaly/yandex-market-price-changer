<script setup lang="ts">
/**
 * «Склад» (TASK-142, ТЗ п.10): по товару — свой склад из прайса, склады
 * площадок, в пути, возвраты, стоимость остатков и дни запаса. Только чтение.
 * Своего склада и FBS площадок не складываем (это один склад), чужие склады
 * (FBY/FBO/FBW) — отдельными колонками.
 */
import { Container, RotateCw } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed, watch } from 'vue';

import InventoryTable from '../components/InventoryTable.vue';
import UnmatchedTable from '../components/UnmatchedTable.vue';
import { FINANCE_FEATURE } from '../inventory.domain';
import { summaryCards, tableColumns, takenAtLines } from '../mappers/mapInventory.inventory';
import { useInventoryStore } from '../store/store.inventory';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { KpiCard } from '@/components/ui/kpi-card';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthStore } from '@/modules/auth/store/store.auth';
import { useMarketplace } from '@/shared/composables';

const store = useInventoryStore();
const auth = useAuthStore();
// Площадка — из адреса (/ozon/inventory, TASK-182): остатки, движения и скорость своей площадки.
const routeMarketplace = useMarketplace();
const marketplace = computed(() => routeMarketplace.value ?? 'ym');
const { data, isLoading, isRefreshing, savedAt, error } = storeToRefs(store);

const ready = computed(() => auth.me !== null);
const withFinance = computed(() => auth.me?.features?.[FINANCE_FEATURE] === true);

const cards = computed(() => (data.value ? summaryCards(data.value) : []));
const columns = computed(() => (data.value ? tableColumns(data.value) : []));
const taken = computed(() => (data.value ? takenAtLines(data.value) : []));

watch(
  () => (ready.value && withFinance.value ? marketplace.value : null),
  (mp) => {
    if (mp !== null) store.ensure(mp);
  },
  { immediate: true },
);
</script>

<template>
  <PageHeader
    title="Склад"
    description="Остатки по товарам: свой склад, склады площадок, в пути и возвраты — и на сколько дней хватит"
  >
    <template #actions>
      <Button variant="outline" :disabled="isLoading || !withFinance" @click="store.refresh()">
        <RotateCw />
        Обновить
      </Button>
    </template>
  </PageHeader>

  <Alert v-if="ready && !withFinance">
    Дни запаса считаются по финансовому журналу — откройте «Финансы» у администратора.
  </Alert>

  <div v-else-if="error && !data" class="flex flex-col items-start gap-3">
    <Alert>{{ error }}</Alert>
    <Button variant="outline" @click="store.retry()">
      <RotateCw />
      Повторить
    </Button>
  </div>

  <div v-else-if="!data" class="flex flex-col gap-4" aria-busy="true">
    <p class="text-sm text-muted-foreground">
      Собираю остатки площадок, заказы в пути и возвраты — это может занять несколько минут…
    </p>
    <div class="grid gap-3 sm:grid-cols-3">
      <Skeleton class="h-24" />
      <Skeleton class="h-24" />
      <Skeleton class="h-24" />
    </div>
    <Skeleton class="h-96 w-full" />
  </div>

  <div v-else class="flex flex-col gap-4">
    <RefreshIndicator
      :refreshing="isRefreshing"
      :saved-at="savedAt"
      :error="error"
      @retry="store.refresh()"
    />

    <div class="grid gap-3 sm:grid-cols-3">
      <KpiCard
        v-for="card in cards"
        :key="card.key"
        :label="card.label"
        :value="card.value"
        :caption="card.caption"
      />
    </div>

    <Alert
      v-for="problem in data.problems"
      :key="`${problem.marketplace}:${problem.storeName}:${problem.problem}`"
    >
      <template v-if="problem.storeName">«{{ problem.storeName }}»: </template>{{ problem.problem }}
    </Alert>

    <EmptyState
      v-if="data.rows.length === 0"
      :icon="Container"
      title="На складе пусто"
      description="Нет ни остатков, ни заказов в пути, ни продаж за окно скорости — или площадки не ответили (причины выше)."
    />
    <InventoryTable
      v-else
      :rows="data.rows"
      :columns="columns"
      :low-days="data.lowDays"
      :basis-days="data.basisDays"
    />

    <UnmatchedTable v-if="data.unmatched.length" :rows="data.unmatched" />

    <ul class="flex flex-col gap-1 text-sm text-muted-foreground">
      <li>
        Итога «на всех складах» нет: FBS площадок — это ваш же склад, а FBY, FBO и FBW — склады
        площадок; FBS не входит и в стоимость.
      </li>
      <li v-if="taken.length">Остатки площадок на: {{ taken.join('; ') }}.</li>
      <li v-for="note in data.notes" :key="note">{{ note }}</li>
    </ul>
  </div>
</template>
