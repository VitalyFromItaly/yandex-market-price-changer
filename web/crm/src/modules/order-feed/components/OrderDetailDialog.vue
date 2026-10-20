<script setup lang="ts">
/**
 * Заказ ленты: прибыль = Σ операций журнала − себестоимость, расходы по
 * статьям и история операций. Строка списка видна сразу, история грузится при
 * открытии; ошибка — внутри диалога.
 */
import type { OrderDetailResponse, OrderFeedRow } from '../order-feed.domain';

import { computed } from 'vue';

import { historyRows } from '../mappers/mapOrderDetail.order-feed';
import {
  expenseArticles,
  itemsLabel,
  moneyOrDash,
  numberLabel,
  profitLabel,
} from '../mappers/orderFeedTable.order-feed';

import { Alert } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatKopecks } from '@/shared/utils';

const props = defineProps<{
  row: OrderFeedRow | null;
  detail: OrderDetailResponse | null;
  loading: boolean;
  error: string | null;
}>();
const emit = defineEmits<{ close: [] }>();

/** Деньги — из детали (свежий журнал), пока она грузится — из строки списка. */
const money = computed(() => props.detail ?? props.row);
const expenses = computed(() => (money.value ? expenseArticles(money.value.articles) : []));
const history = computed(() => (props.detail ? historyRows(props.detail) : []));

function onOpenChange(open: boolean): void {
  if (!open) emit('close');
}
</script>

<template>
  <Dialog :open="row !== null" @update:open="onOpenChange">
    <DialogContent v-if="row && money" class="sm:max-w-4xl">
      <DialogHeader>
        <DialogTitle>Заказ {{ numberLabel(row) }} · {{ row.stageLabel }}</DialogTitle>
        <DialogDescription>{{ itemsLabel(row) }}</DialogDescription>
      </DialogHeader>

      <dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <dt class="text-xs text-muted-foreground">Операции журнала</dt>
          <dd class="tabular-nums">{{ moneyOrDash(money.operationsKopecks) }}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">Себестоимость</dt>
          <dd class="tabular-nums">{{ moneyOrDash(money.cogsKopecks) }}</dd>
        </div>
        <div class="col-span-2">
          <dt class="text-xs text-muted-foreground">Прибыль заказа</dt>
          <dd
            class="text-lg font-semibold tabular-nums"
            :class="{ 'text-danger': (money.profitKopecks ?? 0) < 0 }"
          >
            {{ profitLabel(money) }}
          </dd>
        </div>
      </dl>

      <div v-if="expenses.length">
        <h3 class="mb-2 text-sm font-medium">Расходы по статьям</h3>
        <ul class="flex flex-col gap-1 text-sm">
          <li v-for="article in expenses" :key="article.article" class="flex justify-between">
            <span>{{ article.title }}</span>
            <span class="tabular-nums">{{ formatKopecks(article.kopecks) }}</span>
          </li>
        </ul>
      </div>

      <div>
        <h3 class="mb-2 text-sm font-medium">История операций</h3>
        <Alert v-if="error">{{ error }}</Alert>
        <Skeleton v-else-if="loading" class="h-40 w-full" />
        <p v-else-if="history.length === 0" class="text-sm text-muted-foreground">
          Операций в журнале по этому заказу ещё нет — площадка начисляет их после выкупа.
        </p>
        <div v-else class="max-h-[45vh] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата</TableHead>
                <TableHead>Статья</TableHead>
                <TableHead class="text-right">Сумма</TableHead>
                <TableHead class="hidden text-right sm:table-cell">Себестоимость</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="op in history" :key="op.key">
                <TableCell class="whitespace-nowrap text-muted-foreground">{{ op.day }}</TableCell>
                <TableCell>
                  <div>{{ op.article }}</div>
                  <div class="text-xs text-muted-foreground">{{ op.service }}</div>
                </TableCell>
                <TableCell class="whitespace-nowrap text-right tabular-nums">
                  {{ op.amount }}
                </TableCell>
                <TableCell class="hidden whitespace-nowrap text-right tabular-nums sm:table-cell">
                  {{ op.cogs ?? '' }}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      <p v-if="row.marketplace === 'ym'" class="text-xs text-muted-foreground">
        Услуги Маркета из сводной строки акта (хранение, обработка возвратов) номера заказа не несут
        — в расходы заказа они не входят.
      </p>
    </DialogContent>
  </Dialog>
</template>
