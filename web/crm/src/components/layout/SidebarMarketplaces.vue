<script setup lang="ts">
/**
 * Карточка «Площадки» внизу сайдбара (макет MarketHub). Подключена ли площадка
 * у продавца — говорит сервер (`GET /api/crm/marketplaces`); живая ли она или
 * «скоро» — тоже сервер, через `me.sections` (`useLiveMarketplaces`, тот же
 * список, что у переключателя, табов главной и роутера). Пока сервер не
 * ответил о подключении — без точки: «неизвестно», а не «нет».
 */
import { onMounted } from 'vue';
import { RouterLink } from 'vue-router';

import MarketplaceMark from './MarketplaceMark.vue';

import { useLiveMarketplaces } from '@/modules/marketplaces/composables/useLiveMarketplaces.marketplaces';
import { useMarketplacesStore } from '@/modules/marketplaces/store/store.marketplaces';
import { ALL_MARKETPLACES } from '@/navigation';

const store = useMarketplacesStore();
const { isLive, homeOf } = useLiveMarketplaces();

// Карточка видна на каждом экране — грузим при показе, стор не повторяет запрос.
onMounted(() => void store.ensure());
</script>

<template>
  <section class="rounded-lg border bg-card/60 p-3" aria-label="Площадки">
    <h2 class="mb-2 text-xs text-muted-foreground">Площадки</h2>
    <ul class="flex flex-col gap-1 text-xs">
      <li v-for="m in ALL_MARKETPLACES" :key="m.key">
        <RouterLink
          :to="homeOf(m.key)"
          :class="[
            'flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isLive(m.key) ? '' : 'text-muted-foreground',
          ]"
        >
          <MarketplaceMark :marketplace="m.key" :muted="!isLive(m.key)" class="size-5 rounded" />
          <span class="min-w-0 flex-1 truncate">{{ m.label }}</span>
          <span v-if="!isLive(m.key)">скоро</span>
          <template v-else-if="store.connectionOf(m.key)?.connected === true">
            <span class="size-2 rounded-full bg-ok" title="Подключена" />
            <span class="sr-only">подключена</span>
          </template>
          <span v-else-if="store.connectionOf(m.key)?.connected === false">не подключена</span>
        </RouterLink>
      </li>
    </ul>
  </section>
</template>
