<script setup lang="ts">
import { Check, ChevronsUpDown } from 'lucide-vue-next';

import BrandMark from './BrandMark.vue';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MARKETPLACES } from '@/navigation';

/** Пока пункт один; выбранный — первый. Появится второй маркетплейс — выбор уедет в стор. */
const current = MARKETPLACES[0];
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        class="h-11 w-full justify-between gap-2 px-2"
        aria-label="Выбрать маркетплейс"
      >
        <BrandMark />
        <span class="flex min-w-0 flex-1 flex-col text-left leading-tight">
          <span class="truncate text-sm font-semibold">{{ current?.label }}</span>
          <span class="truncate text-xs font-normal text-muted-foreground">CRM продавца</span>
        </span>
        <ChevronsUpDown class="text-muted-foreground" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="w-56">
      <DropdownMenuLabel>Маркетплейс</DropdownMenuLabel>
      <DropdownMenuItem v-for="m in MARKETPLACES" :key="m.key">
        {{ m.label }}
        <Check v-if="m.key === current?.key" class="ml-auto" />
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
