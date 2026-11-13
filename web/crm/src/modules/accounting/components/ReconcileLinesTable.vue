<script setup lang="ts">
/**
 * Статьи сверки (TASK-228): реестр / документ / разница / статус. Строку с
 * расхождением можно раскрыть до операций; итоговые строки — под чертой.
 */
import type { ReconcileLineKey, ReconcileLineRow } from '../accounting.domain';

import { ChevronDown, ChevronRight } from 'lucide-vue-next';
import { ref } from 'vue';

import ReconcileCandidates from './ReconcileCandidates.vue';

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

defineProps<{ rows: ReconcileLineRow[] }>();

const expanded = ref<ReconcileLineKey | null>(null);
function toggle(key: ReconcileLineKey): void {
  expanded.value = expanded.value === key ? null : key;
}
</script>

<template>
  <Card class="p-0">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Статья</TableHead>
          <TableHead class="text-right">Реестр</TableHead>
          <TableHead class="text-right">Документ</TableHead>
          <TableHead class="text-right">Разница</TableHead>
          <TableHead>Статус</TableHead>
          <TableHead class="w-0" />
        </TableRow>
      </TableHeader>
      <TableBody>
        <template v-for="row in rows" :key="row.key">
          <TableRow :class="row.summary && row.key === 'accrual_total' ? 'border-t-2' : ''">
            <TableCell>
              <div :class="row.summary ? 'font-semibold' : 'font-medium'">{{ row.title }}</div>
              <div v-if="row.manualLabel" class="text-xs text-muted-foreground">
                {{ row.manualLabel }}
              </div>
              <div v-if="row.reason" class="text-xs text-muted-foreground">{{ row.reason }}</div>
            </TableCell>
            <TableCell class="whitespace-nowrap text-right tabular-nums">
              {{ row.registryLabel }}
            </TableCell>
            <TableCell class="whitespace-nowrap text-right tabular-nums">
              {{ row.documentLabel }}
            </TableCell>
            <TableCell
              class="whitespace-nowrap text-right tabular-nums"
              :class="row.tone === 'danger' ? 'text-danger' : ''"
            >
              {{ row.differenceLabel }}
            </TableCell>
            <TableCell>
              <Badge :variant="row.tone">{{ row.statusLabel }}</Badge>
            </TableCell>
            <TableCell>
              <Button
                v-if="row.tone === 'danger'"
                variant="ghost"
                size="sm"
                :aria-expanded="expanded === row.key"
                @click="toggle(row.key)"
              >
                <component
                  :is="expanded === row.key ? ChevronDown : ChevronRight"
                  aria-hidden="true"
                />
                {{ row.candidateCount ? `Операции (${row.candidateCount})` : 'Разобрать' }}
              </Button>
            </TableCell>
          </TableRow>
          <TableRow v-if="expanded === row.key">
            <TableCell colspan="6">
              <ReconcileCandidates :rows="row.candidates" :count="row.candidateCount" />
            </TableCell>
          </TableRow>
        </template>
      </TableBody>
    </Table>
  </Card>
</template>
