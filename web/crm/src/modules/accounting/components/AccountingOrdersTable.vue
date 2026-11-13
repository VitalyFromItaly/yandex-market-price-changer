<script setup lang="ts">
/**
 * Заказы месяца «Финучёта» (TASK-223): подтверждённое и ожидаемое раздельно,
 * прибыль и её состояние. Неизвестная прибыль — словом, не нулём. Клик по номеру
 * открывает карточку заказа.
 */
import type { AccountingOrderRow } from '../accounting.domain';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

defineProps<{ rows: AccountingOrderRow[]; showMarketplace: boolean }>();
const emit = defineEmits<{ open: [AccountingOrderRow] }>();
</script>

<template>
  <Card class="p-0">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Заказ</TableHead>
          <TableHead class="hidden md:table-cell">Товары</TableHead>
          <TableHead class="text-right">Выручка</TableHead>
          <TableHead class="hidden text-right lg:table-cell">Подтверждено</TableHead>
          <TableHead class="hidden text-right lg:table-cell">Ожидается</TableHead>
          <TableHead class="text-right">Прибыль</TableHead>
          <TableHead>Состояние</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="row in rows" :key="row.key">
          <TableCell>
            <Button
              variant="link"
              size="sm"
              class="h-auto p-0 font-medium"
              @click="emit('open', row)"
            >
              {{ row.orderId }}
            </Button>
            <div class="text-xs text-muted-foreground tabular-nums">
              {{ row.dayLabel
              }}<template v-if="showMarketplace"> · {{ row.marketplaceLabel }}</template>
            </div>
          </TableCell>
          <TableCell class="hidden max-w-72 truncate text-muted-foreground md:table-cell">
            {{ row.offersLabel }}
          </TableCell>
          <TableCell class="whitespace-nowrap text-right tabular-nums">
            {{ row.revenueLabel }}
          </TableCell>
          <TableCell class="hidden whitespace-nowrap text-right tabular-nums lg:table-cell">
            {{ row.confirmedLabel }}
          </TableCell>
          <TableCell
            class="hidden whitespace-nowrap text-right tabular-nums text-muted-foreground lg:table-cell"
          >
            {{ row.expectedLabel ?? '—' }}
          </TableCell>
          <TableCell
            class="whitespace-nowrap text-right font-medium tabular-nums"
            :class="{ 'text-danger': row.isLoss, 'text-warn': row.netUnknown }"
          >
            {{ row.netLabel }}
          </TableCell>
          <TableCell>
            <Badge :variant="row.stateTone">{{ row.stateLabel }}</Badge>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
</template>
