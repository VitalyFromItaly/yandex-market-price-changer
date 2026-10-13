<script setup lang="ts">
/**
 * «Unit-экономика по площадкам» (решение crm_unit_economics_platforms): строка
 * Яндекс Маркета — тот же основной блок «Прибыли», что карточки ряда, поэтому
 * числа совпадают с ними. Ozon и Wildberries — приглушённые строки «скоро».
 */
import type { UnitEconomicsRow } from '../dashboard.domain';
import type { RouteLocationRaw } from 'vue-router';

import { RotateCw } from 'lucide-vue-next';
import { RouterLink } from 'vue-router';

import { PRODUCT_TONE_PILL } from '../dashboard.domain';

import MarketplaceMark from '@/components/layout/MarketplaceMark.vue';
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
  rows: UnitEconomicsRow[] | null;
  heading?: string | null;
  to: RouteLocationRaw;
  isRefreshing?: boolean;
  savedAt?: string | null;
  error?: string | null;
  loadingText?: string;
}>();
defineEmits<{ retry: [] }>();
</script>

<template>
  <Card class="flex flex-col">
    <CardHeader class="flex-col gap-0.5 pb-2">
      <CardTitle class="text-base">
        <RouterLink :to="to" class="hover:underline">Unit-экономика по площадкам</RouterLink>
      </CardTitle>
      <p v-if="heading" class="text-xs text-muted-foreground">{{ heading }}</p>
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
        <Skeleton v-for="n in 3" :key="n" class="h-8 w-full" />
        <p v-if="loadingText" class="text-xs text-muted-foreground">{{ loadingText }}</p>
      </div>
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
              <TableHead>Площадка</TableHead>
              <TableHead class="text-right">Продажи</TableHead>
              <TableHead class="hidden text-right sm:table-cell">Комиссия</TableHead>
              <TableHead class="hidden text-right sm:table-cell">Налог</TableHead>
              <TableHead class="hidden text-right md:table-cell">Закуп</TableHead>
              <TableHead class="text-right">Чистая</TableHead>
              <TableHead class="text-right">Маржа</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              v-for="row in rows"
              :key="row.key"
              :class="row.active ? '' : 'text-muted-foreground'"
            >
              <TableCell>
                <div class="flex items-center gap-2">
                  <MarketplaceMark :marketplace="row.key" :muted="!row.active" />
                  <span class="truncate">{{ row.label }}</span>
                  <span v-if="!row.active" class="text-xs">скоро</span>
                </div>
              </TableCell>
              <TableCell class="text-right tnum">{{ row.sales ?? '—' }}</TableCell>
              <TableCell class="hidden text-right tnum sm:table-cell">
                <template v-if="row.commission">
                  {{ row.commission }}
                  <div class="text-xs text-muted-foreground">{{ row.commissionShare }}</div>
                </template>
                <template v-else>—</template>
              </TableCell>
              <TableCell class="hidden text-right tnum sm:table-cell">
                <template v-if="row.tax">
                  {{ row.tax }}
                  <div class="text-xs text-muted-foreground">{{ row.taxShare }}</div>
                </template>
                <template v-else>—</template>
              </TableCell>
              <TableCell class="hidden text-right tnum md:table-cell">
                {{ row.purchase ?? '—' }}
              </TableCell>
              <TableCell class="text-right tnum">{{ row.net ?? '—' }}</TableCell>
              <TableCell class="text-right">
                <span
                  class="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold tnum"
                  :class="PRODUCT_TONE_PILL[row.tone]"
                >
                  {{ row.margin ?? '—' }}
                </span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </template>
    </CardContent>
  </Card>
</template>
