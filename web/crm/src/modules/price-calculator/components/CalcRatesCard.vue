<script setup lang="ts">
/**
 * Ставки расчёта: значение, источник и правка. Источник виден у каждой
 * строки — «факт товара за 30 дней», «тариф ЯМ», «введено» — иначе число
 * нельзя ни проверить, ни оспорить. Пока поле редактируется, в нём остаётся
 * набранный текст: переформатирование на лету стирало бы недописанную запятую.
 */
import type { CalcRateKey, CalcRates, RateSource } from '../price-calculator.domain';

import { reactive } from 'vue';

import { rateInputValue } from '../mappers/mapCalc.price-calculator';
import { CALC_RATE_KEYS, CALC_RATE_META } from '../price-calculator.domain';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const props = defineProps<{
  rates: CalcRates;
  overridden: Partial<Record<CalcRateKey, number>>;
  sourceLabels: Record<RateSource, string>;
  taxLabel: string;
}>();
const emit = defineEmits<{ set: [key: CalcRateKey, text: string]; clear: [key: CalcRateKey] }>();

const drafts = reactive<Partial<Record<CalcRateKey, string>>>({});

const SOURCE_TONE: Partial<Record<RateSource, 'brand' | 'warn' | 'outline'>> = {
  manual: 'brand',
  tariff: 'outline',
  no_data: 'warn',
};

function shown(key: CalcRateKey): string {
  return drafts[key] ?? rateInputValue(key, props.rates[key].value);
}

function onInput(key: CalcRateKey, text: string): void {
  drafts[key] = text;
  emit('set', key, text);
}

function onBlur(key: CalcRateKey): void {
  delete drafts[key];
}

function restore(key: CalcRateKey): void {
  delete drafts[key];
  emit('clear', key);
}
</script>

<template>
  <ul class="flex flex-col divide-y">
    <li
      v-for="key in CALC_RATE_KEYS"
      :key="key"
      class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2"
    >
      <div class="min-w-0">
        <label :for="`rate-${key}`" class="text-sm font-medium">
          {{ CALC_RATE_META[key].label }}
        </label>
        <div class="text-xs text-muted-foreground">
          {{ key === 'tax' ? taxLabel : CALC_RATE_META[key].hint }}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <Badge :variant="SOURCE_TONE[rates[key].source] ?? 'default'">
          {{ sourceLabels[rates[key].source] }}
        </Badge>
        <div class="relative">
          <Input
            :id="`rate-${key}`"
            :model-value="shown(key)"
            class="h-9 w-28 pr-7 text-right tabular-nums"
            inputmode="decimal"
            :aria-invalid="rates[key].value === null ? 'true' : undefined"
            @update:model-value="onInput(key, String($event))"
            @blur="onBlur(key)"
          />
          <span
            class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground"
          >
            {{ CALC_RATE_META[key].unit === 'percent' ? '%' : '₽' }}
          </span>
        </div>
        <Button
          v-if="overridden[key] !== undefined"
          size="sm"
          variant="ghost"
          @click="restore(key)"
        >
          Вернуть
        </Button>
      </div>
    </li>
  </ul>
</template>
