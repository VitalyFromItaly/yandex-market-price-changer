<script setup lang="ts">
/** Дата последней загрузки прайса: от неё зависит свежесть закупа в «Прибыли». */
import type { PriceListInfo } from '../dashboard.domain';

import { RotateCw } from 'lucide-vue-next';
import { computed } from 'vue';
import { RouterLink } from 'vue-router';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { formatMoscowDate } from '@/shared/utils';

const props = defineProps<{
  info: PriceListInfo | null;
  isLoading: boolean;
  isRefreshing?: boolean;
  savedAt?: string | null;
  error: string | null;
  /** Раздел «Прайс» открыт — есть куда вести. */
  linkOpen: boolean;
}>();

defineEmits<{ retry: [] }>();

const date = computed(() =>
  props.info?.updatedAt ? formatMoscowDate(props.info.updatedAt) : null,
);
</script>

<template>
  <Card class="flex flex-col">
    <CardHeader class="pb-2">
      <CardTitle class="text-sm font-medium text-muted-foreground">Прайс загружен</CardTitle>
    </CardHeader>
    <CardContent class="flex flex-1 flex-col gap-1">
      <div v-if="error && !info" class="flex flex-col items-start gap-2">
        <p class="text-sm text-danger">{{ error }}</p>
        <Button variant="ghost" size="sm" @click="$emit('retry')">
          <RotateCw />
          Повторить
        </Button>
      </div>

      <div v-else-if="!info" class="flex flex-col gap-2" aria-busy="true">
        <Skeleton class="h-8 w-32" />
        <Skeleton class="h-4 w-24" />
      </div>

      <template v-else>
        <p class="text-2xl font-semibold tnum" :class="{ 'text-muted-foreground': !date }">
          {{ date ?? 'Ещё не загружали' }}
        </p>
        <RouterLink
          v-if="linkOpen"
          :to="{ name: 'ym-price-list' }"
          class="mt-auto w-fit pt-2 text-sm text-link underline-offset-4 hover:underline"
        >
          {{ date ? 'Загрузить новый' : 'Загрузить прайс' }}
        </RouterLink>
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
