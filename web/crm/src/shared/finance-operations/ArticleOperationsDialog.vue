<script setup lang="ts">
/**
 * Статья или ссылка ИИ-ответа → операции журнала → оригинал отчёта. Итог в
 * шапке — сумма статьи из P&L: операции раскрыты ровно по её id, поэтому сумма
 * раскрытия та же. У ссылки ИИ-ответа итога нет — только число операций.
 */
import type { OpenedArticle, OperationRow } from './financeOperations.domain';

import { Download } from 'lucide-vue-next';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Pagination } from '@/components/ui/pagination';
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
  article: OpenedArticle | null;
  rows: OperationRow[];
  page: number;
  pages: number;
  loading: boolean;
  error: string | null;
  downloadError: string | null;
}>();
const emit = defineEmits<{ close: []; page: [page: number]; download: [documentId: string] }>();

function onOpenChange(open: boolean): void {
  if (!open) emit('close');
}
</script>

<template>
  <Dialog :open="article !== null" @update:open="onOpenChange">
    <DialogContent v-if="article" class="sm:max-w-4xl">
      <DialogHeader>
        <DialogTitle>
          {{ article.title }}<template v-if="article.amount">: {{ article.amount }}</template>
        </DialogTitle>
        <DialogDescription v-if="article.amount">
          {{ article.operationIds.length }} операций журнала. Сумма операций равна сумме статьи.
        </DialogDescription>
        <DialogDescription v-else-if="(article.operationCount ?? 0) > article.operationIds.length">
          Первые {{ article.operationIds.length }} из {{ article.operationCount }} операций журнала
          — все остальные в «Финансах».
        </DialogDescription>
        <DialogDescription v-else>
          {{ article.operationIds.length }} операций журнала.
        </DialogDescription>
      </DialogHeader>

      <Alert v-if="error">{{ error }}</Alert>
      <Alert v-if="downloadError">{{ downloadError }}</Alert>
      <Skeleton v-if="loading && rows.length === 0" class="h-64 w-full" />
      <div v-else class="max-h-[60vh] overflow-auto" :aria-busy="loading">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Дата</TableHead>
              <TableHead>Операция</TableHead>
              <TableHead class="hidden md:table-cell">Заказ / товар</TableHead>
              <TableHead class="text-right">Сумма</TableHead>
              <TableHead class="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="row in rows" :key="row.id">
              <TableCell class="whitespace-nowrap text-muted-foreground">{{ row.day }}</TableCell>
              <TableCell>
                <div>{{ row.kind }}</div>
                <div v-if="row.service" class="text-xs text-muted-foreground">
                  {{ row.service }}
                </div>
              </TableCell>
              <TableCell class="hidden text-sm md:table-cell">
                <div v-if="row.order">Заказ {{ row.order }}</div>
                <div v-if="row.sku" class="text-xs text-muted-foreground">{{ row.sku }}</div>
              </TableCell>
              <TableCell class="whitespace-nowrap text-right tabular-nums">
                <div>{{ row.amount }}</div>
                <div v-if="row.partOf" class="text-xs text-muted-foreground">{{ row.partOf }}</div>
              </TableCell>
              <TableCell class="whitespace-nowrap text-right">
                <Button
                  v-if="row.documentId"
                  variant="ghost"
                  size="sm"
                  aria-label="Скачать оригинал отчёта Маркета"
                  title="Оригинал отчёта Маркета"
                  @click="emit('download', row.documentId)"
                >
                  <Download />
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <Pagination
        :page="page"
        :pages="pages"
        :disabled="loading"
        @update:page="emit('page', $event)"
      />
    </DialogContent>
  </Dialog>
</template>
