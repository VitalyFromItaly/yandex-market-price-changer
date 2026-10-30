<script setup lang="ts">
/**
 * «Куда записать»: строка на площадку. Галочку можно поставить только там, куда
 * сервер разрешил запись (`willWrite`) и есть что записать. Заголовок и подпись
 * строки — от страницы: им пользуются «Прайс» (остатки) и «Установка цен».
 */
import type { StockPushMarketplace } from '../price-list.domain';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';

defineProps<{
  title: string;
  description: string;
  /** `note` — сколько запишем или почему галочку не поставить. */
  options: readonly {
    marketplace: StockPushMarketplace;
    label: string;
    writable: boolean;
    note: string;
  }[];
  isSelected: (marketplace: StockPushMarketplace) => boolean;
  disabled: boolean;
}>();
const emit = defineEmits<{ toggle: [marketplace: StockPushMarketplace, on: boolean] }>();
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>{{ title }}</CardTitle>
      <CardDescription>{{ description }}</CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-2">
      <div
        v-for="option in options"
        :key="option.marketplace"
        class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
      >
        <Checkbox
          :model-value="option.writable && isSelected(option.marketplace)"
          :label="option.label"
          :disabled="disabled || !option.writable"
          @update:model-value="emit('toggle', option.marketplace, $event)"
        />
        <span class="text-sm text-muted-foreground tabular-nums">{{ option.note }}</span>
      </div>
    </CardContent>
  </Card>
</template>
