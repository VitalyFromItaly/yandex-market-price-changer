<script setup lang="ts">
/**
 * Фильтры реестра «Едет обратно» — как в кабинете ЯМ: вкладки со счётчиками, статус,
 * тип и магазин. Номер заказа — поиск таблицы. Отбор строк делает useReturnsFilters.
 */
import type { OrderRowType } from '../orders.domain';

import { useStoreSwitch } from '../composables/useStoreSwitch.orders';
import { ROW_TYPE_LABEL } from '../constants/orderStatus.orders';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatCount } from '@/shared/utils';

/** Ключ вкладки «Все» в Tabs: у reka-ui значение — строка, null не годится. */
const ALL = '__all';

const props = defineProps<{
  tabs: ReadonlyArray<{ key: string | null; label: string; count: number }>;
  tab: string | null;
  status: string | null;
  type: OrderRowType | null;
  statuses: readonly string[];
  active: boolean;
}>();
const emit = defineEmits<{
  'update:tab': [string | null];
  'update:status': [string | null];
  'update:type': [OrderRowType | null];
  clear: [];
}>();

const TYPE_OPTIONS: { value: OrderRowType; label: string }[] = [
  { value: 'nonRedemption', label: ROW_TYPE_LABEL.nonRedemption },
  { value: 'return', label: ROW_TYPE_LABEL.return },
];

const storeSwitch = useStoreSwitch();

function onTab(value: string | number): void {
  emit('update:tab', value === ALL ? null : String(value));
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <Tabs :model-value="props.tab ?? ALL" @update:model-value="onTab">
      <TabsList class="h-auto flex-wrap">
        <TabsTrigger v-for="item in tabs" :key="item.key ?? ALL" :value="item.key ?? ALL">
          {{ item.label }}
          <span class="tnum ml-1.5 text-muted-foreground">{{ formatCount(item.count) }}</span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
    <div class="flex flex-wrap items-center gap-2">
      <Select
        class="w-full sm:w-56"
        label="Статус"
        placeholder="Все статусы"
        :model-value="status"
        :options="statuses.map((label) => ({ value: label, label }))"
        @update:model-value="emit('update:status', $event)"
      />
      <Select
        class="w-full sm:w-44"
        label="Тип"
        placeholder="Невыкупы и возвраты"
        :model-value="type"
        :options="TYPE_OPTIONS"
        @update:model-value="emit('update:type', $event)"
      />
      <Select
        v-if="storeSwitch.options.value.length > 1"
        class="w-full sm:w-64"
        label="Магазин"
        :model-value="storeSwitch.current.value"
        :options="storeSwitch.options.value"
        @update:model-value="storeSwitch.choose($event)"
      />
      <Button v-if="active" variant="ghost" size="sm" @click="emit('clear')">Сбросить</Button>
    </div>
  </div>
</template>
