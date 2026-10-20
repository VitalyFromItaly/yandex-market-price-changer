<script setup lang="ts">
/**
 * Площадка «Обзора»: все или одна. Финжурнал пока только у Яндекс Маркета,
 * поэтому «Все» = ЯМ; Ozon и Wildberries — «скоро», пока площадку нельзя
 * подключить, «подключить», когда можно, и «подключено» после. Не нули:
 * площадка без подключения ничего не продала, а «0 ₽» читалось бы как убыточный
 * месяц.
 */
import type { MarketplaceFilter } from '../overview.domain';
import type { MarketplaceConnection } from '@/modules/marketplaces/marketplaces.domain';

import { computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';

import { MARKETPLACE_FILTER_OPTIONS } from '../overview.domain';

import MarketplaceMark from '@/components/layout/MarketplaceMark.vue';
import { OptionGroup } from '@/components/ui/option-group';
import { useMarketplacesStore } from '@/modules/marketplaces/store/store.marketplaces';
import { UPCOMING_MARKETPLACES } from '@/navigation';

defineProps<{ modelValue: MarketplaceFilter }>();
const emit = defineEmits<{ 'update:modelValue': [MarketplaceFilter] }>();

const marketplaces = useMarketplacesStore();
onMounted(() => void marketplaces.ensure());

function stateOf(connection: MarketplaceConnection | null): string {
  if (connection?.available !== true) return 'скоро';
  return connection.connected ? 'подключено' : 'подключить';
}

const upcoming = computed(() =>
  UPCOMING_MARKETPLACES.map((m) => {
    const connection = marketplaces.connectionOf(m.key);
    return { ...m, state: stateOf(connection) };
  }),
);
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <OptionGroup
      :model-value="modelValue"
      :options="MARKETPLACE_FILTER_OPTIONS"
      label="Площадка"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <RouterLink
      v-for="m in upcoming"
      :key="m.key"
      :to="m.home"
      class="inline-flex h-8 items-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <MarketplaceMark :marketplace="m.key" muted class="size-5 rounded" />
      {{ m.label }}
      <span class="ml-1">{{ m.state }}</span>
    </RouterLink>
  </div>
</template>
