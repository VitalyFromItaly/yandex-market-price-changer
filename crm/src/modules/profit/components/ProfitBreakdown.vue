<script setup lang="ts">
/**
 * Столбец вычитаний — та же цепочка, что сообщение бота: продажи → комиссия
 * (или услуги Маркета) → налог → продвижение → закуп → чистая. Справочная
 * строка калькулятора стоит под комиссией без минуса: в арифметику она не входит.
 *
 * Под каждой строкой — ступень водопада: продажи поднимают уровень, вычеты
 * опускают, чистая рисуется от нуля. Глаз видит, куда ушли деньги, не
 * складывая цифры; сами цифры остаются справа — полоса только масштаб.
 */
import type { Breakdown, BreakdownRow } from '../profit.domain';
import type { ChartTone } from '@/components/ui/chart';

import { computed } from 'vue';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataBar, waterfallSteps } from '@/components/ui/chart';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatCount, formatRub } from '@/shared/utils';

const props = defineProps<{ breakdown: Breakdown }>();

const steps = computed(() => waterfallSteps(props.breakdown.rows));

/** Вычет — нейтральный, не «ошибка»: расход не сбой. Итог — по знаку. */
function toneOf(row: BreakdownRow): ChartTone {
  if (row.kind === 'plus') return 'series';
  if (row.kind === 'total') return row.negative ? 'danger' : 'ok';
  return 'muted';
}

/** Минус у вычитаний — как «➖» у бота, но без эмодзи. */
function sign(kind: string): string {
  return kind === 'minus' ? '− ' : '';
}

const margin = computed(() => {
  const value = props.breakdown.margin;
  return value === null ? null : { text: `${Math.round(value * 100)} %`, negative: value < 0 };
});
</script>

<template>
  <Card>
    <CardHeader class="flex-row items-center justify-between gap-3 space-y-0">
      <CardTitle class="tnum">
        {{ breakdown.countLabel }}: {{ formatCount(breakdown.count) }}
      </CardTitle>
      <Tooltip v-if="margin" text="Маржа — доля чистой в продажах">
        <Badge :variant="margin.negative ? 'danger' : 'ok'" class="tnum" tabindex="0">
          Маржа {{ margin.text }}
        </Badge>
      </Tooltip>
    </CardHeader>
    <CardContent class="flex flex-col gap-3">
      <dl class="flex flex-col">
        <div
          v-for="(row, index) in breakdown.rows"
          :key="row.label"
          :class="cn('flex flex-col gap-1.5 py-1.5', row.kind === 'total' && 'mt-1 border-t pt-3')"
        >
          <div class="flex items-baseline justify-between gap-4">
            <dt :class="cn('text-sm', row.kind === 'info' ? 'pl-4 text-muted-foreground' : '')">
              {{ row.label }}
              <span v-if="row.hint" class="block text-xs text-muted-foreground">{{
                row.hint
              }}</span>
            </dt>
            <dd
              :class="
                cn(
                  'tnum shrink-0 text-right',
                  row.kind === 'total' && 'text-xl font-semibold',
                  row.kind === 'info' && 'text-sm text-muted-foreground',
                  row.negative && 'text-danger',
                )
              "
            >
              {{ sign(row.kind) }}{{ formatRub(row.value) }}
            </dd>
          </div>
          <DataBar
            v-if="steps[index]"
            :step="steps[index]"
            :tone="toneOf(row)"
            :class="row.kind === 'total' ? 'h-2' : 'h-1'"
          />
        </div>
      </dl>
      <p v-if="breakdown.note" class="text-sm text-muted-foreground">{{ breakdown.note }}</p>
    </CardContent>
  </Card>
</template>
