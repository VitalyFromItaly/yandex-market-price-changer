<script setup lang="ts">
/**
 * KPI-карточка: иконка и подпись, крупное число, подстрочник и момент данных.
 * Вся карточка — ссылка в отчёт, откуда число (карточка без ссылки — просто
 * блок). Состояния раздельно: скелетон — только когда показать нечего, ошибка
 * с повтором, пусто (хороший день — словами бэкенда), прошлое число с полосой
 * обновления (RefreshIndicator).
 */
import type { KpiCardTone } from './kpi-card.domain';
import type { Component } from 'vue';
import type { RouteLocationRaw } from 'vue-router';

import { RotateCw } from 'lucide-vue-next';
import { RouterLink } from 'vue-router';

import { KPI_ACCENT_CLASS, KPI_VALUE_CLASS } from './kpi-card.domain';

import { Button } from '@/components/ui/button';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { noBreakDates } from '@/shared/utils';

const props = defineProps<{
  label: string;
  icon?: Component;
  /** Цвет иконки (класс токена); без него — приглушённая, как подпись. */
  iconClass?: string;
  /** Плашка под иконкой (фон и цвет); задана — иконка рисуется в ней. */
  iconTileClass?: string;
  /** Крупное число; null — данных ещё нет. */
  value: string | null;
  caption?: string | null;
  /** Период или момент среза: «на 13-10-2026 10:00 МСК». */
  heading?: string | null;
  /** Пусто — вместо подписи текст бэкенда. */
  emptyText?: string | null;
  tone?: KpiCardTone;
  /** Итоговая карточка ряда — подсвечена тоном числа. */
  accent?: boolean;
  to?: RouteLocationRaw | null;
  isLoading?: boolean;
  isRefreshing?: boolean;
  savedAt?: string | null;
  error?: string | null;
  loadingText?: string;
}>();

defineEmits<{ retry: [] }>();

const toneOf = (): KpiCardTone => props.tone ?? 'neutral';
</script>

<template>
  <div
    :class="
      cn(
        'relative flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-4 text-card-foreground transition-colors',
        accent && value !== null ? KPI_ACCENT_CLASS[toneOf()] : '',
        to && value !== null ? 'hover:bg-muted/60 focus-within:ring-2 focus-within:ring-ring' : '',
      )
    "
  >
    <p class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
      <span
        v-if="icon && iconTileClass"
        :class="cn('flex size-8 shrink-0 items-center justify-center rounded-lg', iconTileClass)"
        aria-hidden="true"
      >
        <component :is="icon" class="size-[18px]" />
      </span>
      <component
        :is="icon"
        v-else-if="icon"
        :class="cn('size-5 shrink-0', iconClass)"
        aria-hidden="true"
      />
      <span class="truncate">{{ label }}</span>
    </p>

    <div v-if="error && value === null" class="flex flex-col items-start gap-2 pt-1">
      <p class="text-sm text-danger">{{ error }}</p>
      <Button variant="ghost" size="sm" @click="$emit('retry')">
        <RotateCw />
        Повторить
      </Button>
    </div>

    <div v-else-if="value === null" class="flex flex-col gap-2 pt-1" aria-busy="true">
      <Skeleton class="h-7 w-24" />
      <Skeleton class="h-4 w-32" />
      <p v-if="loadingText" class="text-xs text-muted-foreground">{{ loadingText }}</p>
    </div>

    <template v-else>
      <!-- Растянутая ссылка: вся карточка кликабельна, а в дереве доступности одна ссылка с числом. -->
      <RouterLink
        v-if="to"
        :to="to"
        :aria-label="`${label}: ${value}`"
        class="w-fit text-2xl font-semibold tnum outline-none after:absolute after:inset-0 after:rounded-lg"
        :class="KPI_VALUE_CLASS[toneOf()]"
      >
        {{ value }}
      </RouterLink>
      <p v-else class="text-2xl font-semibold tnum" :class="KPI_VALUE_CLASS[toneOf()]">
        {{ value }}
      </p>
      <p v-if="emptyText" class="text-sm text-muted-foreground">{{ emptyText }}</p>
      <p v-else-if="caption" class="text-sm" :class="KPI_VALUE_CLASS[toneOf()]">{{ caption }}</p>
      <p v-if="heading" class="mt-auto pt-1 text-xs text-muted-foreground">
        {{ noBreakDates(heading) }}
      </p>
      <RefreshIndicator
        compact
        class="z-10"
        :refreshing="isRefreshing ?? false"
        :saved-at="savedAt ?? null"
        :error="error ?? null"
        @retry="$emit('retry')"
      />
    </template>
  </div>
</template>
