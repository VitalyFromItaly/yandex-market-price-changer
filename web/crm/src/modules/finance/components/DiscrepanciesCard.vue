<script setup lang="ts">
/**
 * Расхождения сверки месяца с заказами и выплатами: причина словами, ссылка
 * на заказ или поручение, ожидалось / по журналу.
 */
import type { DiscrepancyRow } from '../finance.domain';

import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Pagination } from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';

defineProps<{
  rows: DiscrepancyRow[] | null;
  total: number;
  page: number;
  pages: number;
  loading: boolean;
  error: string | null;
}>();
const emit = defineEmits<{ page: [page: number] }>();
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Расхождения</CardTitle>
      <CardDescription>Сверка журнала с заказами и выплатами Маркета</CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-3 text-sm">
      <Alert v-if="error">{{ error }}</Alert>
      <Skeleton v-else-if="rows === null" class="h-24 w-full" />
      <p v-else-if="rows.length === 0" class="text-muted-foreground">Расхождений не найдено.</p>
      <ul v-else class="divide-y" :aria-busy="loading">
        <li v-for="row in rows" :key="row.key" class="flex flex-col gap-1 py-2">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <span class="font-medium">{{ row.label }}</span>
            <span class="text-xs text-muted-foreground">{{ row.operations }}</span>
          </div>
          <div v-if="row.reference" class="text-muted-foreground">{{ row.reference }}</div>
          <div v-if="row.detail" class="text-muted-foreground">{{ row.detail }}</div>
          <div v-if="row.expected || row.actual" class="flex flex-wrap gap-x-4 tabular-nums">
            <span v-if="row.expected">Ожидалось: {{ row.expected }}</span>
            <span v-if="row.actual">По журналу: {{ row.actual }}</span>
          </div>
        </li>
      </ul>
      <p v-if="rows && total > rows.length" class="text-xs text-muted-foreground">
        Всего: {{ total }}
      </p>
      <Pagination
        :page="page"
        :pages="pages"
        :disabled="loading"
        @update:page="emit('page', $event)"
      />
    </CardContent>
  </Card>
</template>
