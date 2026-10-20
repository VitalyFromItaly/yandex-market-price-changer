<script setup lang="ts">
import type { Marketplace } from '@/navigation';

import { Check, ChevronsUpDown } from 'lucide-vue-next';
import { computed } from 'vue';
import { useRouter } from 'vue-router';

import BrandMark from './BrandMark.vue';
import MarketplaceMark from './MarketplaceMark.vue';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ALL_MARKETPLACES, UPCOMING_MARKETPLACES } from '@/navigation';
import { useMarketplace } from '@/shared/composables';

/**
 * Шапка сайдбара: знак и имя кабинета (MarketHub), под ним — площадка из
 * адреса. Выбор ведёт на адрес площадки: у ЯМ — список магазинов, у Ozon/WB
 * пока страница «скоро». Вне площадки (профиль, помощь) подписан ЯМ — разделы
 * в сайдбаре сейчас его.
 */
const router = useRouter();
const marketplace = useMarketplace();
const current = computed(
  () => ALL_MARKETPLACES.find((m) => m.key === (marketplace.value ?? 'ym')) ?? null,
);
const upcoming = new Set(UPCOMING_MARKETPLACES.map((m) => m.key));

function choose(m: Marketplace): void {
  void router.push(m.home);
}
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
          <span class="truncate text-base font-extrabold tracking-tight">MarketHub</span>
          <span class="truncate text-xs font-normal text-muted-foreground">{{
            current?.label
          }}</span>
        </span>
        <ChevronsUpDown class="text-muted-foreground" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="w-56">
      <DropdownMenuLabel>Маркетплейс</DropdownMenuLabel>
      <DropdownMenuItem v-for="m in ALL_MARKETPLACES" :key="m.key" @select="choose(m)">
        <MarketplaceMark :marketplace="m.key" :muted="upcoming.has(m.key)" class="size-5 rounded" />
        <span class="flex-1">{{ m.label }}</span>
        <Check v-if="m.key === current?.key" class="ml-auto" />
        <span v-else-if="upcoming.has(m.key)" class="text-xs text-muted-foreground">скоро</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
