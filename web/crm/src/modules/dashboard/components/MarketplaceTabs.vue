<script setup lang="ts">
/**
 * Площадки над сводкой. Сводка — Яндекс Маркета, он и выбран; Ozon и
 * Wildberries — ссылки на их страницу «скоро»: адрес площадки живой, разделов
 * у неё пока нет. Не вкладки: другая площадка — другой раздел, а не другой
 * срез этой сводки.
 */
import { RouterLink } from 'vue-router';

import { UPCOMING_MARKETPLACES } from '../dashboard.domain';

import MarketplaceMark from '@/components/layout/MarketplaceMark.vue';
import { MARKETPLACES } from '@/navigation';
</script>

<template>
  <div class="flex flex-wrap items-center gap-2" role="group" aria-label="Площадки">
    <span
      v-for="m in MARKETPLACES"
      :key="m.key"
      class="inline-flex h-8 items-center gap-2 rounded-md border border-primary bg-primary-subtle px-3 text-xs font-medium shadow-[0_0_0_1px] shadow-primary/40"
      aria-current="true"
    >
      <MarketplaceMark :marketplace="m.key" class="size-5 rounded" />
      {{ m.label }}
    </span>
    <RouterLink
      v-for="m in UPCOMING_MARKETPLACES"
      :key="m.key"
      :to="m.home"
      class="inline-flex h-8 items-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <MarketplaceMark :marketplace="m.key" muted class="size-5 rounded" />
      {{ m.label }}
      <span class="ml-1">скоро</span>
    </RouterLink>
  </div>
</template>
