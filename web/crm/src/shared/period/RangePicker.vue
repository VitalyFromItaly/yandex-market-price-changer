<script setup lang="ts">
/**
 * Период по дням («Обзор», «Unit-экономика»): пресеты ТЗ кнопками и два поля дат у «Периода». Свои даты
 * применяются, только когда период пригоден (не задом наперёд, не будущее,
 * не длиннее года), — иначе под полями причина, а задача не ставится.
 */
import type { RangePreset } from '@/shared/period';
import type { DayRange } from '@/shared/utils';

import { computed, ref, watch } from 'vue';

import { MAX_RANGE_DAYS, RANGE_PRESET_OPTIONS, isValidRange } from './range';

import { Input } from '@/components/ui/input';
import { OptionGroup } from '@/components/ui/option-group';
import { moscowToday } from '@/shared/utils';

const props = defineProps<{ preset: RangePreset; custom: DayRange | null }>();
const emit = defineEmits<{ preset: [RangePreset]; custom: [DayRange] }>();

const today = moscowToday();
const from = ref(props.custom?.from ?? '');
const to = ref(props.custom?.to ?? '');

watch(
  () => props.custom,
  (next) => {
    from.value = next?.from ?? '';
    to.value = next?.to ?? '';
  },
);

const invalid = computed(
  () =>
    props.preset === 'custom' &&
    from.value !== '' &&
    to.value !== '' &&
    !isValidRange({ from: from.value, to: to.value }, today),
);

function apply(): void {
  const next = { from: from.value, to: to.value };
  if (isValidRange(next, today)) emit('custom', next);
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <OptionGroup
      :model-value="preset"
      :options="RANGE_PRESET_OPTIONS"
      label="Период"
      @update:model-value="emit('preset', $event)"
    />
    <div v-if="preset === 'custom'" class="flex flex-wrap items-center gap-2">
      <Input
        v-model="from"
        type="date"
        class="h-8 w-40"
        aria-label="Начало периода"
        :max="today"
        @change="apply"
      />
      <span class="text-muted-foreground">—</span>
      <Input
        v-model="to"
        type="date"
        class="h-8 w-40"
        aria-label="Конец периода"
        :max="today"
        @change="apply"
      />
      <span v-if="invalid" class="text-xs text-danger" role="alert">
        Начало не позже конца, без будущих дней, не длиннее {{ MAX_RANGE_DAYS }} дней
      </span>
    </div>
  </div>
</template>
