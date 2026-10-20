<script setup lang="ts">
/**
 * «На исходе» — проданные за период товары с доступным остатком не больше
 * порога (решение crm_low_stock_threshold), до пяти, самые пустые первыми.
 * Ссылка — туда, где остаток пополняют: на FBY в «FBY», иначе в «Прайс».
 */
import type { LowStockRow } from '../dashboard.domain';
import type { RouteLocationRaw } from 'vue-router';

import { RotateCw } from 'lucide-vue-next';
import { RouterLink } from 'vue-router';

import { PRODUCT_TONE_PILL } from '../dashboard.domain';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';

defineProps<{
  /** null — остатки или товары ещё собираются. */
  rows: LowStockRow[] | null;
  threshold: number;
  /** Остатков нет совсем — причина вместо списка. */
  problem?: string | null;
  link?: { to: RouteLocationRaw; label: string } | null;
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
      <CardTitle class="text-base">На исходе</CardTitle>
      <p class="text-xs text-muted-foreground">
        Проданные за период, в наличии не больше {{ threshold }} шт.
      </p>
    </CardHeader>
    <CardContent class="flex flex-1 flex-col gap-2">
      <div v-if="error && rows === null" class="flex flex-col items-start gap-2">
        <p class="text-sm text-danger">{{ error }}</p>
        <Button variant="ghost" size="sm" @click="$emit('retry')">
          <RotateCw />
          Повторить
        </Button>
      </div>
      <p v-else-if="problem" class="text-sm text-muted-foreground">{{ problem }}</p>
      <div v-else-if="rows === null" class="flex flex-col gap-2" aria-busy="true">
        <Skeleton v-for="n in 3" :key="n" class="h-6 w-full" />
        <p v-if="loadingText" class="text-xs text-muted-foreground">{{ loadingText }}</p>
      </div>
      <p v-else-if="rows.length === 0" class="text-sm text-muted-foreground">
        Всё, что продаётся, есть в наличии.
      </p>
      <template v-else>
        <RefreshIndicator
          compact
          :refreshing="isRefreshing ?? false"
          :saved-at="savedAt ?? null"
          :error="error"
          @retry="$emit('retry')"
        />
        <ul class="flex flex-col divide-y">
          <li
            v-for="row in rows"
            :key="row.sku"
            class="flex items-baseline justify-between gap-3 py-2"
          >
            <div class="min-w-0">
              <div class="truncate text-sm" :title="row.name">{{ row.name }}</div>
              <div class="truncate text-xs text-muted-foreground tnum">
                {{ row.sku }} · продано {{ row.sold }}
              </div>
            </div>
            <span
              class="inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold tnum"
              :class="PRODUCT_TONE_PILL[row.out ? 'danger' : 'warn']"
            >
              {{ row.out ? 'нет' : `${row.stock} шт.` }}
            </span>
          </li>
        </ul>
      </template>
      <RouterLink
        v-if="link"
        :to="link.to"
        class="mt-auto text-sm text-muted-foreground hover:text-foreground hover:underline"
      >
        {{ link.label }} →
      </RouterLink>
    </CardContent>
  </Card>
</template>
