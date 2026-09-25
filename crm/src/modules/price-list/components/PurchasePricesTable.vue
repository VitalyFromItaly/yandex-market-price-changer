<script setup lang="ts">
/**
 * Закупочные цены продавца: поиск по артикулу или названию, страницы по 50.
 * Две цены рядом: в прайсе — как в файле, закуп — после скидки бренда, то
 * есть то, чем считает «Прибыль» (считает сервер, фронт не пересчитывает).
 */
import type { PurchasePricesPage } from '../price-list.domain';

import { Search } from 'lucide-vue-next';

import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCount, formatRub } from '@/shared/utils';

defineProps<{ page: PurchasePricesPage | null; loading: boolean; query: string }>();
const search = defineModel<string>('search', { default: '' });
const emit = defineEmits<{ 'update:page': [page: number] }>();
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <Input
        v-model="search"
        type="search"
        class="max-w-sm"
        placeholder="Артикул или название"
        aria-label="Поиск по артикулу или названию"
      />
      <p v-if="page" class="tnum text-sm text-muted-foreground">
        Позиций: {{ formatCount(page.total) }}
        <template v-if="page.lastUpdated"> · прайс загружен {{ page.lastUpdated }}</template>
      </p>
    </div>

    <Skeleton v-if="!page" class="h-96 w-full" aria-busy="true" />

    <EmptyState
      v-else-if="page.total === 0 && query.length > 0"
      :icon="Search"
      title="Ничего не нашлось"
      :description="`По запросу «${query}» нет ни артикула, ни названия.`"
    />

    <EmptyState
      v-else-if="page.total === 0"
      title="Закупочных цен пока нет"
      description="Они появятся после первой загрузки прайса — на вкладке «Загрузка»."
    />

    <template v-else>
      <Card class="p-0" :aria-busy="loading">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Артикул</TableHead>
              <TableHead class="hidden md:table-cell">Название</TableHead>
              <TableHead class="hidden lg:table-cell">Категория</TableHead>
              <TableHead class="text-right">В прайсе</TableHead>
              <TableHead class="text-right">Закуп</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="item in page.items" :key="item.sku">
              <TableCell class="font-mono text-sm">{{ item.sku }}</TableCell>
              <TableCell class="hidden max-w-xs truncate md:table-cell">
                {{ item.name ?? '—' }}
              </TableCell>
              <TableCell class="hidden text-muted-foreground lg:table-cell">
                {{ item.category ?? '—' }}
              </TableCell>
              <TableCell class="tnum text-right text-muted-foreground">
                {{ formatRub(item.price) }}
              </TableCell>
              <TableCell class="tnum text-right">{{ formatRub(item.cost) }}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>
      <Pagination
        :page="page.page"
        :pages="page.pages"
        :disabled="loading"
        @update:page="emit('update:page', $event)"
      />
    </template>
  </div>
</template>
