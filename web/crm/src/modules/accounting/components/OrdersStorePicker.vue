<script setup lang="ts">
/**
 * Магазин заказов «Финучёта» (TASK-223): страница — уровня аккаунта, а список и
 * карточка считаются по магазину. Магазин называется по имени, ключ — хэш.
 */
import { Check, ChevronDown, Store } from 'lucide-vue-next';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

defineProps<{
  options: { key: string; label: string }[];
  selected: string | null;
  label: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ select: [string] }>();
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="outline" :disabled="disabled" aria-label="Магазин">
        <Store aria-hidden="true" />
        <span class="max-w-48 truncate">{{ label }}</span>
        <ChevronDown class="text-muted-foreground" aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-64">
      <DropdownMenuItem
        v-for="option in options"
        :key="option.key"
        @select="emit('select', option.key)"
      >
        <Check class="shrink-0" :class="option.key === selected ? '' : 'invisible'" />
        <span class="truncate">{{ option.label }}</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
