<script setup lang="ts">
/**
 * Раскрытие расхождения статьи до операций (TASK-228): дубль, другая дата, нет
 * пары в документе. Строка, равная разнице по модулю, — первая и помечена.
 */
import type { ReconcileCandidateRow } from '../accounting.domain';

import { Badge } from '@/components/ui/badge';

defineProps<{ rows: ReconcileCandidateRow[]; count: number }>();
</script>

<template>
  <div class="flex flex-col gap-2 py-1">
    <p v-if="!rows.length" class="text-sm text-muted-foreground">
      Отдельных операций, объясняющих разницу, не нашлось — сверьте строки статьи в отчёте Маркета.
    </p>
    <ul v-else class="flex flex-col divide-y rounded-md border bg-muted/30">
      <li
        v-for="row in rows"
        :key="row.id"
        class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
      >
        <Badge :variant="row.matchesDifference ? 'danger' : 'outline'">{{ row.reasonLabel }}</Badge>
        <span class="min-w-0 flex-1 truncate">{{ row.title }}</span>
        <span class="text-muted-foreground">{{ row.orderLabel }}</span>
        <span class="tabular-nums text-muted-foreground">
          {{ row.dayLabel
          }}<template v-if="row.documentDayLabel"> · документ {{ row.documentDayLabel }}</template>
        </span>
        <Badge v-if="row.manual" variant="default">ручная</Badge>
        <span class="w-28 text-right font-medium tabular-nums">{{ row.amountLabel }}</span>
      </li>
    </ul>
    <p v-if="count > rows.length" class="text-xs text-muted-foreground">
      Показаны {{ rows.length }} из {{ count }}.
    </p>
  </div>
</template>
