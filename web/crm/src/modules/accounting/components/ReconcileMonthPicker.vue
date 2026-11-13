<script setup lang="ts">
/** Выбор месяца — закрытого у сверки (TASK-228), с текущим у заказов (TASK-223). */
import type { ReconcileMonthOption } from '../composables/useReconcileMonth.accounting';

import { CalendarDays, Check, ChevronDown } from 'lucide-vue-next';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

withDefaults(
  defineProps<{
    options: ReconcileMonthOption[];
    label: string;
    disabled?: boolean;
    ariaLabel?: string;
  }>(),
  { disabled: false, ariaLabel: 'Месяц сверки' },
);
const month = defineModel<string>({ required: true });
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="outline" :disabled="disabled" :aria-label="ariaLabel">
        <CalendarDays aria-hidden="true" />
        {{ label }}
        <ChevronDown class="text-muted-foreground" aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-56">
      <DropdownMenuItem
        v-for="option in options"
        :key="option.value"
        @select="month = option.value"
      >
        <Check class="shrink-0" :class="option.value === month ? '' : 'invisible'" />
        {{ option.label }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
