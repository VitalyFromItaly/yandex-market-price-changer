<script setup lang="ts">
/**
 * Карточка «Площадки» внизу сайдбара (макет MarketHub). Подключена ли площадка
 * у продавца — говорит сервер (`GET /api/crm/marketplaces`); есть ли у неё
 * разделы в CRM — сборка (`UPCOMING_MARKETPLACES`, тот же список, что у табов
 * главной). Пока сервер не ответил — без точки: «неизвестно», а не «нет».
 */
import type { MarketplaceKey } from '@/navigation';

import { onMounted } from 'vue';
import { RouterLink } from 'vue-router';

import MarketplaceMark from './MarketplaceMark.vue';

import { useMarketplacesStore } from '@/modules/marketplaces/store/store.marketplaces';
import { ALL_MARKETPLACES, UPCOMING_MARKETPLACES } from '@/navigation';

const store = useMarketplacesStore();
const upcoming = new Set<MarketplaceKey>(UPCOMING_MARKETPLACES.map((m) => m.key));

// Карточка видна на каждом экране — грузим при показе, стор не повторяет запрос.
onMounted(() => void store.ensure());
</script>

<template>
  <section class="rounded-lg border bg-card/60 p-3" aria-label="Площадки">
    <h2 class="mb-2 text-xs text-muted-foreground">Площадки</h2>
    <ul class="flex flex-col gap-1 text-xs">
      <li v-for="m in ALL_MARKETPLACES" :key="m.key">
        <RouterLink
          :to="m.home"
          :class="[
            'flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            upcoming.has(m.key) ? 'text-muted-foreground' : '',
          ]"
        >
          <MarketplaceMark
            :marketplace="m.key"
            :muted="upcoming.has(m.key)"
            class="size-5 rounded"
          />
          <span class="min-w-0 flex-1 truncate">{{ m.label }}</span>
          <span v-if="upcoming.has(m.key)">скоро</span>
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
