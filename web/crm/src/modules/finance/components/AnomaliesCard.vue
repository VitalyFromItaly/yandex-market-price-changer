<script setup lang="ts">
/**
 * Аномалии журнала месяца (TASK-149): что не так словами, какой порог
 * сработал, деньги, операции (открываются тем же диалогом, что статья P&L) и
 * отметка «просмотрено». Непросмотренные — сверху; новый штраф того же вида
 * снимает отметку сам (решение `finance_anomaly_review_fingerprint`).
 */
import type { AnomaliesModel, AnomalyFilter, AnomalyRow } from '../finance.domain';

import { ANOMALY_FILTERS } from '../finance.domain';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { OptionGroup } from '@/components/ui/option-group';
import { Pagination } from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';

defineProps<{
  model: AnomaliesModel | null;
  filter: AnomalyFilter;
  page: number;
  pages: number;
  loading: boolean;
  error: string | null;
  reviewError: string | null;
  /** Ключ аномалии, отметка которой сохраняется. */
  reviewing: string | null;
}>();
const emit = defineEmits<{
  page: [page: number];
  filter: [filter: AnomalyFilter];
  review: [key: string, reviewed: boolean];
  open: [row: AnomalyRow];
}>();
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle class="flex flex-wrap items-center gap-2">
        Аномалии
        <Badge v-if="model && model.unreviewed > 0" variant="warn" class="tabular-nums">
          {{ model.unreviewed }} новых
        </Badge>
      </CardTitle>
      <CardDescription>
        Подозрительное в журнале месяца — у каждой строки порог, по которому она найдена.
        <template v-if="model?.checkedLabel">{{ model.checkedLabel }}.</template>
      </CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-3 text-sm">
      <OptionGroup
        :model-value="filter"
        :options="ANOMALY_FILTERS"
        label="Какие аномалии показать"
        :disabled="loading"
        @update:model-value="emit('filter', $event)"
      />
      <Alert v-if="error">{{ error }}</Alert>
      <Alert v-if="reviewError">{{ reviewError }}</Alert>
      <Skeleton v-if="!error && model === null" class="h-24 w-full" />
      <template v-else-if="model">
        <p v-if="model.checkedLabel === null" class="text-muted-foreground">
          Месяц ещё не проверялся — аномалии ищутся после ночной загрузки журнала.
        </p>
        <p v-else-if="model.rows.length === 0" class="text-muted-foreground">
          {{ filter === 'new' ? 'Новых аномалий нет.' : 'Аномалий не найдено.' }}
        </p>
        <ul v-else class="divide-y" :aria-busy="loading">
          <li
            v-for="row in model.rows"
            :key="row.key"
            class="flex flex-col gap-1 py-2"
            :class="{ 'opacity-70': row.reviewed }"
          >
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <span class="font-medium">{{ row.label }}</span>
              <span v-if="row.amount" class="tabular-nums">{{ row.amount }}</span>
            </div>
            <div v-if="row.reference" class="text-muted-foreground">{{ row.reference }}</div>
            <div>{{ row.detail }}</div>
            <div class="text-xs text-muted-foreground">Порог: {{ row.threshold }}</div>
            <div class="flex flex-wrap items-center gap-2 pt-1">
              <Button
                v-if="row.operationIds.length"
                variant="link"
                size="sm"
                class="h-auto px-0"
                @click="emit('open', row)"
              >
                {{ row.operations }}
              </Button>
              <span v-else class="text-xs text-muted-foreground">{{ row.operations }}</span>
              <Button
                :variant="row.reviewed ? 'ghost' : 'outline'"
                size="sm"
                class="ml-auto"
                :disabled="reviewing !== null"
                @click="emit('review', row.key, !row.reviewed)"
              >
                {{ row.reviewed ? 'Вернуть в новые' : 'Просмотрено' }}
              </Button>
            </div>
          </li>
        </ul>
        <p v-if="model.total > model.rows.length" class="text-xs text-muted-foreground">
          Всего: {{ model.total }}
        </p>
      </template>
      <Pagination
        :page="page"
        :pages="pages"
        :disabled="loading"
        @update:page="emit('page', $event)"
      />
    </CardContent>
  </Card>
</template>
