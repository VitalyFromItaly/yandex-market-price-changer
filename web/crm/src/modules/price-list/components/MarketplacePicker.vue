<script setup lang="ts">
/**
 * «Куда записать остатки»: строка на площадку. Галочку можно поставить только
 * там, куда сервер разрешил запись (`willWrite`) и есть что записать.
 */
import type { PushMarketplaceOption, StockPushMarketplace } from '../price-list.domain';

import { optionNote } from '../mappers/mapStockPush.price-list';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';

defineProps<{
  options: PushMarketplaceOption[];
  isSelected: (marketplace: StockPushMarketplace) => boolean;
  disabled: boolean;
}>();
const emit = defineEmits<{ toggle: [marketplace: StockPushMarketplace, on: boolean] }>();
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Куда записать остатки</CardTitle>
      <CardDescription>
        Отметьте площадки — остатки уйдут только туда. Закупочные цены отдельно не отправляются: они
        общие для всех площадок.
      </CardDescription>
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
        <span class="text-sm text-muted-foreground tabular-nums">{{ optionNote(option) }}</span>
      </div>
    </CardContent>
  </Card>
</template>
