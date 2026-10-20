<script setup lang="ts">
/**
 * Отчётные периоды нарастающим итогом: доход, налог, уменьшение, к уплате,
 * аванс периода и сверка с бухгалтерией. Сверку открывает строка.
 */
import type { TaxPeriodRow, TaxYearPeriodKey } from '../taxes.domain';

import { ClipboardCheck } from 'lucide-vue-next';

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

defineProps<{ rows: TaxPeriodRow[]; reductionsApply: boolean; disabled: boolean }>();
const emit = defineEmits<{ reconcile: [key: TaxYearPeriodKey] }>();
</script>

<template>
  <Card class="p-0">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Период</TableHead>
          <TableHead class="text-right">Доход</TableHead>
          <TableHead class="text-right">Налог</TableHead>
          <TableHead v-if="reductionsApply" class="hidden text-right md:table-cell"
            >Уменьшение</TableHead
          >
          <TableHead class="text-right">К уплате</TableHead>
          <TableHead class="hidden text-right sm:table-cell">Аванс периода</TableHead>
          <TableHead>Сверка</TableHead>
          <TableHead class="w-0" />
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="row in rows" :key="row.key">
          <TableCell>
            <div class="flex flex-col">
              <span class="font-medium">{{ row.label }}</span>
              <span class="text-xs text-muted-foreground">
                {{ row.range }}<template v-if="!row.closed"> · идёт</template>
              </span>
            </div>
          </TableCell>
          <TableCell class="text-right tabular-nums">{{ row.income }}</TableCell>
          <TableCell class="text-right tabular-nums">
            {{ row.tax }}
            <div v-if="row.minimumApplied" class="text-xs text-muted-foreground">
              минимальный 1 %
            </div>
          </TableCell>
          <TableCell v-if="reductionsApply" class="hidden text-right tabular-nums md:table-cell">
            {{ row.reduction }}
          </TableCell>
          <TableCell class="text-right font-medium tabular-nums">{{ row.due }}</TableCell>
          <TableCell class="hidden text-right tabular-nums sm:table-cell">
            {{ row.advance }}
            <div v-if="row.advanceNegative" class="text-xs text-muted-foreground">к зачёту</div>
          </TableCell>
          <TableCell>
            <Badge
              v-if="row.reconciliation?.checked"
              :variant="row.reconciliation.hasDiff ? 'warn' : 'ok'"
            >
              {{ row.reconciliation.hasDiff ? 'расхождение' : 'сверено' }}
            </Badge>
            <Badge v-else-if="row.reconciliation?.hasDiff" variant="warn">расхождение</Badge>
            <span v-else class="text-xs text-muted-foreground">не сверено</span>
            <div v-if="row.reconciliation?.diff" class="text-xs text-muted-foreground tabular-nums">
              {{ row.reconciliation.diff }}
            </div>
          </TableCell>
          <TableCell>
            <Button
              variant="ghost"
              size="sm"
              :aria-label="`Сверка: ${row.label}`"
              :disabled="disabled"
              @click="emit('reconcile', row.key)"
            >
              <ClipboardCheck />
            </Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
</template>
