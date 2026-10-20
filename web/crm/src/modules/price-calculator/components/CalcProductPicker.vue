<script setup lang="ts">
/**
 * Выбор товара: поиск по названию и артикулу и короткий список совпадений.
 * Выпадающего списка в ките нет, а товаров — тысячи: список из восьми
 * совпадений помещается и не прячет выбор. «Без товара» — все ставки руками.
 */
import type { CalcSkuResponse } from '../price-calculator.domain';

import { computed, ref } from 'vue';

import { filterCalcSkus } from '../mappers/mapCalc.price-calculator';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatCount, formatKopecks } from '@/shared/utils';

const props = defineProps<{ skus: readonly CalcSkuResponse[]; selected: CalcSkuResponse | null }>();
const emit = defineEmits<{ choose: [sku: string | null] }>();

const query = ref('');
const matches = computed(() => filterCalcSkus(props.skus, query.value, 8));

function choose(sku: string | null): void {
  query.value = '';
  emit('choose', sku);
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div v-if="selected" class="flex flex-wrap items-center gap-2 text-sm">
      <span class="font-medium">{{ selected.name ?? selected.sku }}</span>
      <span v-if="selected.name" class="text-muted-foreground">{{ selected.sku }}</span>
      <Button size="sm" variant="ghost" @click="choose(null)">Сменить</Button>
    </div>

    <template v-else>
      <Input
        v-model="query"
        class="h-9"
        placeholder="Название или артикул"
        aria-label="Поиск товара"
      />
      <ul v-if="matches.length" class="flex flex-col divide-y rounded-md border">
        <li v-for="sku in matches" :key="sku.sku">
          <button
            type="button"
            class="flex w-full flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
            @click="choose(sku.sku)"
          >
            <span class="min-w-0">
              <span class="font-medium">{{ sku.name ?? sku.sku }}</span>
              <span v-if="sku.name" class="ml-2 text-xs text-muted-foreground">{{ sku.sku }}</span>
            </span>
            <span class="tabular-nums text-xs text-muted-foreground">
              {{ formatCount(sku.units) }} шт.
              <template v-if="sku.avgPriceKopecks !== null">
                · {{ formatKopecks(sku.avgPriceKopecks) }}
              </template>
            </span>
          </button>
        </li>
      </ul>
      <p v-else-if="query" class="text-sm text-muted-foreground">
        Среди проданных за 30 дней не нашлось — можно посчитать без товара.
      </p>
      <p class="text-xs text-muted-foreground">
        Без товара ставки — средние по всем товарам, закуп вводится руками.
      </p>
    </template>
  </div>
</template>
