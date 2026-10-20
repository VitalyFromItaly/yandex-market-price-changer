<script setup lang="ts">
/**
 * Блок «Заказы» (образец MarketHub): строка на статус — число, сумма и шеврон в
 * отчёт. Каждая строка живёт состоянием своего источника: скелетон, пока нечего
 * показать, ошибка с повтором, приглушение на фоновом обновлении.
 */
import type { OrderRowKey, OrderRowView } from '../dashboard.domain';
import type { RouteLocationRaw } from 'vue-router';

import { ArrowRight, ChevronRight, RotateCw } from 'lucide-vue-next';
import { RouterLink } from 'vue-router';

import { ICON_TONE_CLASS } from '../dashboard.domain';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

defineProps<{
  rows: OrderRowView[];
  /** «Все заказы →» — раздел «Заказы»; закрыт — ссылки нет. */
  allTo?: RouteLocationRaw | null;
}>();

defineEmits<{ retry: [key: OrderRowKey] }>();

/** «—» вместо суммы: у отмен её нет, у нуля заказов она ничего не говорит. */
const amountOf = (row: OrderRowView): string => row.summary?.amount ?? '—';
</script>

<template>
  <Card>
    <CardHeader class="flex-row items-center justify-between gap-3 space-y-0 pb-2">
      <CardTitle class="text-base">Заказы</CardTitle>
      <RouterLink
        v-if="allTo"
        :to="allTo"
        class="inline-flex items-center gap-1 text-sm text-link hover:underline"
      >
        Все заказы
        <ArrowRight class="size-4" aria-hidden="true" />
      </RouterLink>
    </CardHeader>
    <CardContent class="pb-2">
      <ul class="divide-y">
        <li
          v-for="row in rows"
          :key="row.key"
          class="relative -mx-2 rounded-md px-2 transition-colors"
          :class="row.summary ? 'hover:bg-muted/60 focus-within:ring-2 focus-within:ring-ring' : ''"
        >
          <div
            class="flex min-h-14 items-center gap-3 py-2 transition-opacity"
            :class="row.isRefreshing ? 'opacity-70' : ''"
            :aria-busy="row.summary === null || row.isRefreshing"
          >
            <span
              class="flex size-9 shrink-0 items-center justify-center rounded-md"
              :class="ICON_TONE_CLASS[row.iconTone].tile"
              aria-hidden="true"
            >
              <component :is="row.icon" class="size-5" />
            </span>
            <div class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-sm font-medium">{{ row.label }}</span>
              <span v-if="row.summary?.heading" class="truncate text-xs text-muted-foreground">
                {{ row.summary.heading }}
              </span>
            </div>

            <div
              v-if="row.error && row.summary === null"
              class="flex items-center gap-2 text-right"
            >
              <span class="text-sm text-danger">{{ row.error }}</span>
              <Button variant="ghost" size="sm" @click="$emit('retry', row.key)">
                <RotateCw />
                Повторить
              </Button>
            </div>

            <div v-else-if="row.summary === null" class="flex flex-col items-end gap-1">
              <Skeleton class="h-5 w-12" />
              <span class="text-xs text-muted-foreground">{{ row.loadingText }}</span>
            </div>

            <template v-else>
              <!-- Растянутая ссылка: вся строка кликабельна, в дереве доступности — одна ссылка. -->
              <RouterLink
                :to="row.to"
                :aria-label="`${row.label}: ${row.summary.count}, ${amountOf(row)}`"
                class="flex items-baseline gap-3 rounded-md outline-none after:absolute after:inset-0 after:rounded-md"
              >
                <span
                  class="text-lg font-semibold tnum"
                  :class="ICON_TONE_CLASS[row.iconTone].text"
                >
                  {{ row.summary.count }}
                </span>
                <span class="min-w-28 text-right text-sm text-muted-foreground tnum">
                  {{ amountOf(row) }}
                </span>
              </RouterLink>
              <ChevronRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </template>
          </div>
        </li>
      </ul>
    </CardContent>
  </Card>
</template>
