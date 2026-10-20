<script setup lang="ts">
/**
 * Результат: главное число крупно (прибыль при цене или цена для цели) и
 * разложение от цены к прибыли — Σ строк = прибыли, так что ответ можно
 * проверить глазами. Нет ответа — причина, а не ноль.
 */
import type { CalcView } from '../mappers/mapCalc.price-calculator';
import type { CalcMode, CalcRateKey } from '../price-calculator.domain';

import { formatPercent } from '../mappers/mapCalc.price-calculator';
import { CALC_RATE_META } from '../price-calculator.domain';

import { formatKopecks } from '@/shared/utils';

defineProps<{ view: CalcView; mode: CalcMode }>();

const missingLabels = (keys: CalcRateKey[]) =>
  keys.map((key) => CALC_RATE_META[key].label.toLocaleLowerCase('ru-RU')).join(', ');
</script>

<template>
  <div class="flex flex-col gap-4">
    <p v-if="view.state === 'missing'" class="text-sm text-muted-foreground">
      Не хватает ставок: {{ missingLabels(view.keys) }} — введите их слева.
    </p>
    <p v-else-if="view.state === 'input'" class="text-sm text-muted-foreground">
      {{ mode === 'profit' ? 'Введите цену товара.' : 'Введите нужную прибыль.' }}
    </p>
    <p v-else-if="view.state === 'failure'" class="text-sm text-danger">{{ view.text }}</p>

    <template v-else>
      <div class="flex flex-col gap-1">
        <span class="text-sm text-muted-foreground">
          {{ mode === 'profit' ? 'Прибыль со штуки' : 'Цена для этой прибыли' }}
        </span>
        <span
          class="text-3xl font-semibold tabular-nums"
          :class="mode === 'profit' && view.result.profitKopecks < 0 ? 'text-danger' : ''"
        >
          {{
            mode === 'profit'
              ? formatKopecks(view.result.profitKopecks)
              : formatKopecks(view.result.priceKopecks)
          }}
        </span>
        <span class="text-sm text-muted-foreground tabular-nums">
          рентабельность {{ formatPercent(view.result.margin) }}
        </span>
      </div>

      <dl class="flex flex-col divide-y text-sm">
        <div
          v-for="line in view.lines"
          :key="line.label"
          class="flex items-baseline justify-between gap-4 py-1.5"
        >
          <dt :class="line.strong ? 'font-semibold' : 'text-muted-foreground'">{{ line.label }}</dt>
          <dd class="tabular-nums" :class="line.strong ? 'font-semibold' : ''">{{ line.value }}</dd>
        </div>
      </dl>
    </template>
  </div>
</template>
