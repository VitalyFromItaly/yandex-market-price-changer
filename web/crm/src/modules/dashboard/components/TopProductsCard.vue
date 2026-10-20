<script setup lang="ts">
/**
 * «Топ товаров» — десять артикулов с наибольшими продажами за период главной.
 * Продажи, чистая и возвраты — из того же результата «Прибыли», что карточки
 * (Σ по товарам = «Продажи»), остаток — отдельным срезом «сейчас». Остатка
 * нет — «—», а не ноль: ноль соврал бы, что товар кончился.
 */
import type { TopSkuRow } from '../dashboard.domain';
import type { RouteLocationRaw } from 'vue-router';

import { ArrowRight, RotateCw } from 'lucide-vue-next';
import { RouterLink } from 'vue-router';

import { PRODUCT_TONE_PILL, RANK_CLASS, RANK_REST_CLASS } from '../dashboard.domain';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

defineProps<{
  rows: TopSkuRow[] | null;
  heading?: string | null;
  to: RouteLocationRaw;
  isRefreshing?: boolean;
  savedAt?: string | null;
  error?: string | null;
  loadingText?: string;
  /** Почему в колонке остатка «—» (остатки не пришли). */
  stockNote?: string | null;
}>();
defineEmits<{ retry: [] }>();
</script>

<template>
  <Card>
    <CardHeader class="flex-row items-start justify-between gap-3 space-y-0 pb-2">
      <div class="flex min-w-0 flex-col gap-0.5">
        <CardTitle class="text-base">Топ товаров по продажам</CardTitle>
        <p v-if="heading" class="text-xs text-muted-foreground">{{ heading }}</p>
      </div>
      <RouterLink
        :to="to"
        class="inline-flex shrink-0 items-center gap-1 text-sm text-link hover:underline"
      >
        В «Прибыль»
        <ArrowRight class="size-4" aria-hidden="true" />
      </RouterLink>
    </CardHeader>
    <CardContent class="flex flex-col gap-2">
      <div v-if="error && rows === null" class="flex flex-col items-start gap-2">
        <p class="text-sm text-danger">{{ error }}</p>
        <Button variant="ghost" size="sm" @click="$emit('retry')">
          <RotateCw />
          Повторить
        </Button>
      </div>
      <div v-else-if="rows === null" class="flex flex-col gap-2" aria-busy="true">
        <Skeleton v-for="n in 5" :key="n" class="h-6 w-full" />
        <p v-if="loadingText" class="text-xs text-muted-foreground">{{ loadingText }}</p>
      </div>
      <p v-else-if="rows.length === 0" class="text-sm text-muted-foreground">
        За период продаж нет.
      </p>
      <template v-else>
        <RefreshIndicator
          compact
          :refreshing="isRefreshing ?? false"
          :saved-at="savedAt ?? null"
          :error="error"
          @retry="$emit('retry')"
        />
        <Table>
          <TableHeader class="bg-muted/50">
            <TableRow>
              <TableHead class="w-8">#</TableHead>
              <TableHead>Товар</TableHead>
              <TableHead class="hidden md:table-cell">SKU</TableHead>
              <TableHead class="text-right">Остаток</TableHead>
              <TableHead class="text-right">Продано</TableHead>
              <TableHead class="hidden text-right lg:table-cell">Продажи</TableHead>
              <TableHead class="text-right">Маржа</TableHead>
              <TableHead class="hidden text-right sm:table-cell">Возвраты</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="(row, index) in rows" :key="row.sku">
              <TableCell>
                <span
                  class="flex size-6 items-center justify-center rounded-full text-xs font-semibold tnum"
                  :class="RANK_CLASS[index] ?? RANK_REST_CLASS"
                >
                  {{ index + 1 }}
                </span>
              </TableCell>
              <TableCell class="max-w-[16rem]">
                <div class="truncate" :title="row.name">{{ row.name }}</div>
                <div class="truncate text-xs text-muted-foreground tnum md:hidden">
                  {{ row.sku }}
                </div>
              </TableCell>
              <TableCell
                class="hidden max-w-[10rem] truncate text-muted-foreground tnum md:table-cell"
              >
                {{ row.sku }}
              </TableCell>
              <TableCell class="text-right">
                <span
                  class="inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold tnum"
                  :class="PRODUCT_TONE_PILL[row.stockTone]"
                >
                  {{ row.stock === null ? '—' : `${row.stock} шт.` }}
                </span>
              </TableCell>
              <TableCell class="text-right tnum">{{ row.sold }} шт.</TableCell>
              <TableCell class="hidden text-right tnum lg:table-cell">{{ row.revenue }}</TableCell>
              <TableCell class="text-right">
                <span
                  class="inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold tnum"
                  :class="PRODUCT_TONE_PILL[row.tone]"
                >
                  {{ row.margin ?? '—' }}
                </span>
              </TableCell>
              <TableCell class="hidden text-right tnum sm:table-cell">{{ row.returns }}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p v-if="stockNote" class="text-xs text-muted-foreground">Остатки: {{ stockNote }}</p>
      </template>
    </CardContent>
  </Card>
</template>
