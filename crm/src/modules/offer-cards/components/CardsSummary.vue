<script setup lang="ts">
/**
 * Итоги среза — те же строки, что сообщение бота: всего карточек, средний
 * рейтинг против среднего по категории и счётчики по статусам (сначала те, что
 * требуют действий).
 */
import type { CardsReport } from '../offer-cards.domain';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { formatCount } from '@/shared/utils';

defineProps<{ report: CardsReport }>();
</script>

<template>
  <Card>
    <CardContent class="flex flex-col gap-5 pt-5">
      <dl class="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <dt class="text-sm text-muted-foreground">Карточек</dt>
          <dd class="tnum mt-1 text-2xl font-semibold">{{ formatCount(report.totalCards) }}</dd>
        </div>
        <div>
          <dt class="text-sm text-muted-foreground">Средний рейтинг карточки</dt>
          <dd class="tnum mt-1 text-2xl font-semibold">
            {{ report.averageRating === null ? '—' : `${report.averageRating}%` }}
          </dd>
          <dd
            v-if="report.averageBenchmark !== null"
            class="tnum mt-1 text-sm text-muted-foreground"
          >
            в среднем по категории: {{ report.averageBenchmark }}%
          </dd>
        </div>
      </dl>

      <ul v-if="report.byStatus.length" class="flex flex-col gap-1.5 border-t pt-4 text-sm">
        <li
          v-for="item in report.byStatus"
          :key="item.status"
          class="flex items-center justify-between gap-3"
        >
          <span class="flex items-center gap-2">
            <Badge v-if="item.actionable" variant="warn">нужно действие</Badge>
            {{ item.label }}
          </span>
          <span class="tnum font-medium">{{ formatCount(item.count) }}</span>
        </li>
      </ul>
    </CardContent>
  </Card>
</template>
