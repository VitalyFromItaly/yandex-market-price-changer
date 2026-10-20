<script setup lang="ts">
/**
 * Выбор месяца со статусом журнала у каждого: статус, сверка и оригинал
 * отчёта помесячные (решение finance_crm_month_picker). Произвольный период
 * из ссылки «Обзора» (`rangeLabel`) показывается на кнопке; выбор месяца его снимает.
 */
import type { MonthOption } from '../finance.domain';

import { CalendarDays, Check, ChevronDown } from 'lucide-vue-next';
import { computed } from 'vue';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const props = defineProps<{
  options: MonthOption[];
  modelValue: string | null;
  rangeLabel?: string | null;
  disabled?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [month: string] }>();

const current = computed(() => props.options.find((o) => o.value === props.modelValue) ?? null);
const buttonLabel = computed(() => props.rangeLabel ?? current.value?.label ?? 'Месяц');
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="outline"
        :disabled="disabled || options.length === 0"
        aria-label="Выбрать месяц"
      >
        <CalendarDays />
        {{ buttonLabel }}
        <ChevronDown class="text-muted-foreground" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-72">
      <DropdownMenuLabel>Месяц</DropdownMenuLabel>
      <DropdownMenuItem
        v-for="option in options"
        :key="option.value"
        @select="emit('update:modelValue', option.value)"
      >
        <Check class="shrink-0" :class="option.value === modelValue ? '' : 'invisible'" />
        <span class="flex-1">{{ option.label }}</span>
        <Badge :variant="option.tone">{{ option.statusLabel }}</Badge>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
