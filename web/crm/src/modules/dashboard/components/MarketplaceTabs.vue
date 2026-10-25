<script setup lang="ts">
/**
 * Площадки над сводкой. Сводка — Яндекс Маркета, он и выбран; Ozon и
 * Wildberries — ссылки: живая площадка ведёт в свои разделы, площадка «скоро»
 * (сервер ещё не открыл её фичу) — на свою страницу «скоро». Список — тот же,
 * что у переключателя и роутера (`useLiveMarketplaces`). Не вкладки: другая
 * площадка — другой раздел, а не другой срез этой сводки.
 */
import { RouterLink } from 'vue-router';

import MarketplaceMark from '@/components/layout/MarketplaceMark.vue';
import { useLiveMarketplaces } from '@/modules/marketplaces/composables/useLiveMarketplaces.marketplaces';
import { ALL_MARKETPLACES } from '@/navigation';

const { isLive, homeOf } = useLiveMarketplaces();
const others = ALL_MARKETPLACES.filter((m) => m.key !== 'ym');
const ym = ALL_MARKETPLACES.filter((m) => m.key === 'ym');
</script>

<template>
  <div class="flex flex-wrap items-center gap-2" role="group" aria-label="Площадки">
    <span
      v-for="m in ym"
      :key="m.key"
      class="inline-flex h-8 items-center gap-2 rounded-md border border-primary bg-primary-subtle px-3 text-xs font-medium shadow-[0_0_0_1px] shadow-primary/40"
      aria-current="true"
    >
      <MarketplaceMark :marketplace="m.key" class="size-5 rounded" />
      {{ m.label }}
    </span>
    <template v-for="m in others" :key="m.key">
      <RouterLink
        v-if="isLive(m.key)"
        :to="homeOf(m.key)"
        class="inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MarketplaceMark :marketplace="m.key" class="size-5 rounded" />
        {{ m.label }}
      </RouterLink>
      <RouterLink
        v-else
        :to="homeOf(m.key)"
        class="inline-flex h-8 items-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MarketplaceMark :marketplace="m.key" muted class="size-5 rounded" />
        {{ m.label }}
        <span class="ml-1">скоро</span>
      </RouterLink>
    </template>
  </div>
</template>
