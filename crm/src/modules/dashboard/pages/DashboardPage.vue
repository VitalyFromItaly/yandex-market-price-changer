<script setup lang="ts">
/**
 * «Главная»: что едет к покупателю и обратно, что уехало сегодня, прибыль с
 * 1 числа, свежесть прайса и разделы. Каждая плитка — своя фоновая задача (та
 * же, что у страницы отчёта), грузится и падает сама по себе.
 */
import type { TileMeta } from '../dashboard.domain';
import type { RouteLocationRaw } from 'vue-router';

import { computed, watch } from 'vue';

import DashboardTile from '../components/DashboardTile.vue';
import PriceListTile from '../components/PriceListTile.vue';
import QuickLinks from '../components/QuickLinks.vue';
import { useDashboardTiles } from '../composables/useDashboardTiles.dashboard';
import { useDashboardStore } from '../store/store.dashboard';

import { PageHeader } from '@/components/ui/page-header';
import { useStoreKey } from '@/shared/composables';
import { periodQuery } from '@/shared/period';

const store = useDashboardStore();
const storeKey = useStoreKey();
const { ready, tiles, links, priceListOpen } = useDashboardTiles();

function targetOf(meta: TileMeta): RouteLocationRaw {
  return {
    name: meta.route,
    params: { report: meta.report },
    query: meta.period === null ? {} : periodQuery(meta.period),
  };
}

// Грузим, когда /auth/me ответил, и заново — только если набор плиток
// изменился (профиль перечитывается при возврате во вкладку).
const openKeys = computed(() => (ready.value ? tiles.value.map((meta) => meta.key) : null));
watch(
  () => openKeys.value?.join(','),
  () => {
    if (openKeys.value !== null) store.load(openKeys.value, storeKey.value);
  },
  { immediate: true },
);
</script>

<template>
  <PageHeader title="Главная" description="Состояние магазина — числа ведут в отчёты" />

  <div class="flex flex-col gap-8">
    <section aria-label="Сводка" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <DashboardTile
        v-for="meta in tiles"
        :key="meta.key"
        :label="meta.label"
        :to="targetOf(meta)"
        :summary="store.tiles[meta.key].summary"
        :is-loading="store.tiles[meta.key].isLoading"
        :is-refreshing="store.tiles[meta.key].isRefreshing"
        :saved-at="store.tiles[meta.key].savedAt"
        :error="store.tiles[meta.key].error"
        :loading-text="meta.loadingText"
        @retry="store.tiles[meta.key].retry()"
      />
      <PriceListTile
        :info="store.priceList.info"
        :is-loading="store.priceList.isLoading"
        :is-refreshing="store.priceList.isRefreshing"
        :saved-at="store.priceList.savedAt"
        :error="store.priceList.error"
        :link-open="priceListOpen"
        @retry="store.priceList.load()"
      />
    </section>

    <section v-if="links.length" aria-labelledby="dashboard-links" class="flex flex-col gap-3">
      <h2 id="dashboard-links" class="text-sm font-medium text-muted-foreground">Разделы</h2>
      <QuickLinks :items="links" />
    </section>
  </div>
</template>
