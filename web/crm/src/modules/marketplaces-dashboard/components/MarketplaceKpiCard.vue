<script setup lang="ts">
/**
 * Площадка на дашборде: знак и имя ведут в её «Финансы», показатели — в
 * «Сравнение площадок» за тот же период. Чисел нет — «нет данных» с причиной
 * от сервера, а не нули.
 */
import type { DashboardCard } from '../mappers/mapDashboard.marketplaces-dashboard';
import type { RouteLocationRaw } from 'vue-router';

import { RouterLink } from 'vue-router';

import MarketplaceMark from '@/components/layout/MarketplaceMark.vue';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

defineProps<{ card: DashboardCard; compareTo: RouteLocationRaw }>();
</script>

<template>
  <Card class="flex flex-col">
    <CardHeader class="flex-row items-center gap-3 pb-3">
      <MarketplaceMark :marketplace="card.marketplace" :muted="card.reason !== null" />
      <CardTitle class="min-w-0 flex-1 truncate text-base">
        <RouterLink :to="card.to" class="hover:underline">{{ card.label }}</RouterLink>
      </CardTitle>
      <Badge v-if="card.statusLabel" :variant="card.statusTone">{{ card.statusLabel }}</Badge>
    </CardHeader>
    <CardContent class="flex-1">
      <div v-if="card.reason" class="flex flex-col gap-1">
        <p class="text-sm font-medium">Нет данных</p>
        <p class="text-sm text-muted-foreground">{{ card.reason }}</p>
      </div>
      <dl v-else class="flex flex-col gap-2 text-sm">
        <div
          v-for="kpi in card.kpis"
          :key="kpi.key"
          class="flex items-baseline justify-between gap-3"
        >
          <dt>
            <RouterLink
              :to="compareTo"
              class="text-muted-foreground hover:text-foreground hover:underline"
            >
              {{ kpi.label }}
            </RouterLink>
          </dt>
          <dd
            class="tnum text-right"
            :class="[
              kpi.key === 'revenue' || kpi.key === 'net' ? 'font-semibold' : '',
              kpi.tone === 'danger' ? 'text-danger' : '',
            ]"
          >
            {{ kpi.value }}
          </dd>
        </div>
      </dl>
    </CardContent>
  </Card>
</template>
