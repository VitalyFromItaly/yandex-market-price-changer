<script setup lang="ts">
/**
 * Период отчёта — те же пять вариантов, что кнопки бота. «Другой день»
 * раскрывает поле даты; глубина ограничена 30 днями, если архив не открыт
 * (сервер проверяет сам, здесь — чтобы не вести продавца в отказ).
 */
import type { PeriodKey, ReportPeriod } from './period';

import { Info } from 'lucide-vue-next';
import { computed, ref, watch } from 'vue';

import {
  HISTORY_WINDOW_DAYS,
  PERIOD,
  PERIOD_LABEL,
  dayToIso,
  isoToDay,
  minDayIso,
  moscowTodayIso,
} from './period';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/tooltip';

const props = defineProps<{ modelValue: ReportPeriod; unlimited: boolean; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [ReportPeriod] }>();

const KEYS: PeriodKey[] = [PERIOD.TODAY, PERIOD.DAY, PERIOD.WEEK, PERIOD.MONTH, PERIOD.ALL];

// «Другой день» выбран, а дата ещё не введена — отчёт пока не пересобираем.
const pickingDay = ref(props.modelValue.key === PERIOD.DAY);
const dayIso = ref(dayToIso(props.modelValue.day));

watch(
  () => props.modelValue,
  (value) => {
    pickingDay.value = value.key === PERIOD.DAY;
    dayIso.value = dayToIso(value.day);
  },
);

const max = computed(() => moscowTodayIso());
const min = computed(() => minDayIso(props.unlimited) ?? undefined);
const hint = computed(() =>
  props.unlimited
    ? 'Можно и старше 30 дней — данные придут из архива Маркета.'
    : `Яндекс.Маркет хранит заказы не старше ${HISTORY_WINDOW_DAYS} дней.`,
);

function isActive(key: PeriodKey): boolean {
  return key === PERIOD.DAY ? pickingDay.value : !pickingDay.value && props.modelValue.key === key;
}

function choose(key: PeriodKey): void {
  if (key === PERIOD.DAY) {
    pickingDay.value = true;
    return;
  }
  pickingDay.value = false;
  emit('update:modelValue', { key, day: null });
}

function onDay(value: string | number | undefined): void {
  const day = isoToDay(String(value ?? ''));
  if (day !== null) emit('update:modelValue', { key: PERIOD.DAY, day });
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-1" role="group" aria-label="Период отчёта">
    <Button
      v-for="key in KEYS"
      :key="key"
      size="sm"
      :variant="isActive(key) ? 'soft' : 'ghost'"
      :aria-pressed="isActive(key)"
      :disabled="disabled"
      @click="choose(key)"
    >
      {{ PERIOD_LABEL[key] }}
    </Button>
    <div v-if="pickingDay" class="flex items-center gap-1">
      <Input
        v-model="dayIso"
        type="date"
        class="h-8 w-40"
        aria-label="День отчёта"
        :min="min"
        :max="max"
        :disabled="disabled"
        @update:model-value="onDay"
      />
      <Tooltip :text="hint">
        <Button variant="ghost" size="icon" class="size-8" aria-label="Про глубину истории">
          <Info />
        </Button>
      </Tooltip>
    </div>
  </div>
</template>
