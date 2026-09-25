<script setup lang="ts">
/**
 * Плитка главной. Состояния раздельно: первая загрузка (скелетон — только
 * когда показать нечего), ошибка с повтором, пусто (хороший день — словами
 * бэкенда) и число-ссылка в отчёт с тем же периодом. Есть прошлое число —
 * оно на плитке, а обновление идёт полосой внизу (RefreshIndicator).
 */
import type { TileSummary } from '../dashboard.domain';
import type { RouteLocationRaw } from 'vue-router';

import { RotateCw } from 'lucide-vue-next';
import { RouterLink } from 'vue-router';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';

defineProps<{
  label: string;
  to: RouteLocationRaw;
  summary: TileSummary | null;
  isLoading: boolean;
  /** На плитке прошлое число, свежее собирается. */
  isRefreshing?: boolean;
  savedAt?: string | null;
  error: string | null;
  /** Подсказка на время сборки: прибыль считается дольше остальных. */
  loadingText?: string;
}>();

defineEmits<{ retry: [] }>();
</script>

<template>
  <Card class="flex flex-col">
    <CardHeader class="pb-2">
      <CardTitle class="text-sm font-medium text-muted-foreground">{{ label }}</CardTitle>
    </CardHeader>
    <CardContent class="flex flex-1 flex-col gap-1">
      <div v-if="error && !summary" class="flex flex-col items-start gap-2">
        <p class="text-sm text-danger">{{ error }}</p>
        <Button variant="ghost" size="sm" @click="$emit('retry')">
          <RotateCw />
          Повторить
        </Button>
      </div>

      <div v-else-if="!summary" class="flex flex-col gap-2" aria-busy="true">
        <Skeleton class="h-8 w-24" />
        <Skeleton class="h-4 w-40" />
        <p v-if="loadingText" class="text-xs text-muted-foreground">{{ loadingText }}</p>
      </div>

      <template v-else>
        <RouterLink
          :to="to"
          class="w-fit rounded-sm text-2xl font-semibold tnum hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="{ 'text-danger': summary.negative }"
        >
          {{ summary.value }}
        </RouterLink>
        <p v-if="summary.empty" class="text-sm text-muted-foreground">{{ summary.emptyText }}</p>
        <p v-else-if="summary.caption" class="text-sm">{{ summary.caption }}</p>
        <p class="mt-auto pt-2 text-xs text-muted-foreground">{{ summary.heading }}</p>
        <RefreshIndicator
          compact
          class="pt-1"
          :refreshing="isRefreshing ?? false"
          :saved-at="savedAt ?? null"
          :error="error"
          @retry="$emit('retry')"
        />
      </template>
    </CardContent>
  </Card>
</template>
