<script setup lang="ts">
/**
 * Журнал синхронизации «Финучёта» (TASK-212): по площадке — «данные на …» (последний
 * успех), по месяцам окна — исход последней попытки, ошибка и пропуски. Пропущенный
 * месяц (успеха не было) расписание ставит в очередь само — кнопки здесь нет.
 */
import type { SyncMarketplaceRow, SyncTone } from '../accounting.domain';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

defineProps<{ row: SyncMarketplaceRow }>();

const BADGE: Record<SyncTone, 'ok' | 'danger' | 'warn' | 'outline'> = {
  ok: 'ok',
  failed: 'danger',
  missed: 'warn',
  idle: 'outline',
};
</script>

<template>
  <Card class="flex flex-col gap-3 p-4">
    <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h3 class="text-base font-semibold">{{ row.label }}</h3>
      <span class="text-sm text-muted-foreground">{{ row.asOfLabel }}</span>
    </div>
    <ul class="flex flex-col divide-y">
      <li
        v-for="period in row.periods"
        :key="period.key"
        class="flex flex-col gap-1 py-2 first:pt-0 last:pb-0"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-medium">{{ period.monthLabel }}</span>
          <Badge :variant="BADGE[period.tone]">{{ period.statusLabel }}</Badge>
          <span class="text-sm text-muted-foreground">{{ period.successLabel }}</span>
        </div>
        <div v-if="period.attemptLabel" class="text-xs text-muted-foreground">
          {{ period.attemptLabel }}
        </div>
        <div v-if="period.error" class="text-xs text-danger">{{ period.error }}</div>
      </li>
    </ul>
  </Card>
</template>
