<script setup lang="ts">
/**
 * Площадки над сводкой. Подключена одна — она и выбрана; Ozon и Wildberries —
 * неактивный каркас с подсказкой «скоро». Выбора пока нет, поэтому это не
 * вкладки (нечего переключать), а подписанная группа.
 */
import { UPCOMING_MARKETPLACES } from '../dashboard.domain';

import MarketplaceMark from '@/components/layout/MarketplaceMark.vue';
import { Tooltip } from '@/components/ui/tooltip';
import { MARKETPLACES } from '@/navigation';
</script>

<template>
  <div class="flex flex-wrap items-center gap-2" role="group" aria-label="Площадки">
    <span
      v-for="m in MARKETPLACES"
      :key="m.key"
      class="inline-flex h-9 items-center gap-2 rounded-md border border-primary bg-card px-3 text-sm font-medium"
      aria-current="true"
    >
      <MarketplaceMark :marketplace="m.key" />
      {{ m.label }}
    </span>
    <Tooltip
      v-for="m in UPCOMING_MARKETPLACES"
      :key="m.key"
      text="Скоро — пока подключён только Яндекс Маркет"
    >
      <span
        tabindex="0"
        class="inline-flex h-9 cursor-not-allowed items-center gap-2 rounded-md border border-dashed px-3 text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-disabled="true"
      >
        <MarketplaceMark :marketplace="m.key" muted />
        {{ m.label }}
        <span class="ml-2 text-xs">скоро</span>
      </span>
    </Tooltip>
  </div>
</template>
