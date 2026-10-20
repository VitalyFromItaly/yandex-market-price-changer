<script setup lang="ts">
/**
 * Товары среза: поиск по артикулу, фильтр по оценке, сортировка по клику на
 * заголовок, показ порциями. «—» — Маркет не назвал цену или порог (не ноль).
 */
import type { RecommendationRow, RecommendationSortKey } from '../recommendations.domain';

import { Search } from 'lucide-vue-next';
import { toRef } from 'vue';

import {
  PAGE_ROWS,
  useRecommendationsTable,
} from '../composables/useRecommendationsTable.recommendations';
import { COMPETITIVENESS_FILTERS } from '../recommendations.domain';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { OptionGroup } from '@/components/ui/option-group';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSortHead,
} from '@/components/ui/table';
import { formatCount, formatRub } from '@/shared/utils';

const props = defineProps<{ rows: readonly RecommendationRow[] }>();

const table = useRecommendationsTable(toRef(props, 'rows'));

function sortProps(key: RecommendationSortKey) {
  return {
    active: table.sort.value.key === key,
    direction: table.sort.value.dir,
    onSort: () => table.toggleSort(key),
  };
}

function rub(value: number | null): string {
  return value === null ? '—' : formatRub(value);
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-3">
      <div class="relative w-full max-w-sm">
        <Search
          class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          v-model="table.query.value"
          type="search"
          class="pl-9"
          placeholder="Артикул"
          aria-label="Поиск по артикулу"
        />
      </div>
      <OptionGroup
        v-model="table.competitiveness.value"
        :options="COMPETITIVENESS_FILTERS"
        label="Оценка Маркета"
      />
    </div>

    <Card class="p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableSortHead label="Артикул" v-bind="sortProps('offerId')" />
            <TableSortHead label="Цена" align="right" v-bind="sortProps('price')" />
            <TableHead class="hidden text-right md:table-cell">Привлекательная до</TableHead>
            <TableHead class="hidden text-right lg:table-cell">Умеренная до</TableHead>
            <TableSortHead label="Дороже на" align="right" v-bind="sortProps('deltaAbs')" />
            <TableSortHead
              label="%"
              align="right"
              class="hidden sm:table-cell"
              v-bind="sortProps('deltaPercent')"
            />
            <TableHead class="hidden md:table-cell">Оценка</TableHead>
            <TableSortHead
              label="Показы за 7 дней"
              align="right"
              class="hidden lg:table-cell"
              v-bind="sortProps('shows')"
            />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="row in table.visible.value" :key="row.id">
            <TableCell class="max-w-56 truncate font-medium" :title="row.offerId">
              {{ row.offerId }}
            </TableCell>
            <TableCell class="tnum text-right">{{ rub(row.price) }}</TableCell>
            <TableCell class="tnum hidden text-right md:table-cell">
              {{ rub(row.optimalPrice) }}
            </TableCell>
            <TableCell class="tnum hidden text-right lg:table-cell">
              {{ rub(row.averagePrice) }}
            </TableCell>
            <TableCell class="tnum text-right">{{ rub(row.deltaAbs) }}</TableCell>
            <TableCell class="tnum hidden text-right sm:table-cell">
              {{ row.deltaPercent === null ? '—' : `${row.deltaPercent}%` }}
            </TableCell>
            <TableCell class="hidden md:table-cell">
              <Badge :variant="row.competitiveness === 'LOW' ? 'danger' : 'warn'">
                {{ row.competitivenessLabel }}
              </Badge>
            </TableCell>
            <TableCell class="tnum hidden text-right lg:table-cell">
              {{ row.shows === null ? '—' : formatCount(row.shows) }}
            </TableCell>
          </TableRow>
          <TableRow v-if="table.matched.value.length === 0">
            <TableCell colspan="8" class="py-8 text-center text-muted-foreground">
              Ничего не нашлось — измените запрос или фильтр.
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>

    <div v-if="table.hidden.value" class="flex items-center justify-center gap-3">
      <span class="tnum text-sm text-muted-foreground">
        Показано {{ formatCount(table.visible.value.length) }} из
        {{ formatCount(table.matched.value.length) }}
      </span>
      <Button variant="ghost" size="sm" @click="table.showMore">
        Показать ещё {{ Math.min(PAGE_ROWS, table.hidden.value) }}
      </Button>
    </div>
  </div>
</template>
