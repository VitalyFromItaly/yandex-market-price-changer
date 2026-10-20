<script setup lang="ts">
/**
 * Корректировки: что Маркет поменял в новой версии отчёта месяца — строка
 * изменилась или пропала. Старые строки не удаляются, а снимаются.
 */
import type { CorrectionRow } from '../finance.domain';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Pagination } from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';

defineProps<{
  rows: CorrectionRow[] | null;
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
      <CardTitle>Корректировки</CardTitle>
      <CardDescription>Что Маркет изменил в отчёте месяца после первой загрузки</CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-3 text-sm">
      <Alert v-if="error">{{ error }}</Alert>
      <Skeleton v-else-if="rows === null" class="h-24 w-full" />
      <p v-else-if="rows.length === 0" class="text-muted-foreground">Корректировок не было.</p>
      <ul v-else class="divide-y" :aria-busy="loading">
        <li v-for="row in rows" :key="row.key" class="flex items-start gap-3 py-2">
          <Badge :variant="row.after === null ? 'danger' : 'warn'">{{ row.kindLabel }}</Badge>
          <span class="min-w-0 flex-1">
            <span class="block">{{ row.what }}</span>
            <span class="block text-xs text-muted-foreground">{{ row.version }}</span>
          </span>
          <span class="whitespace-nowrap text-right tabular-nums">
            <span class="block text-muted-foreground line-through">{{ row.before }}</span>
            <span v-if="row.after" class="block">{{ row.after }}</span>
          </span>
        </li>
      </ul>
      <Pagination
        :page="page"
        :pages="pages"
        :disabled="loading"
        @update:page="emit('page', $event)"
      />
    </CardContent>
  </Card>
</template>
