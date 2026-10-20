<script setup lang="ts">
/**
 * «Обзор» (TASK-125, ТЗ п.1): главная по всему кабинету за любой период.
 * Деньги, заказы и штуки — из финжурнала тем же расчётом, что «Финансы»
 * (карточка ведёт в «Прибыль» с тем же периодом и там та же цифра); отмены,
 * остатки и товары в пути — срезы Маркета по всем магазинам кабинета.
 */
import type { KpiKey, KpiLink, KpiMeta } from '../overview.domain';
import type { RangePreset } from '@/shared/period';
import type { Component } from 'vue';
import type { RouteLocationRaw } from 'vue-router';

import {
  BadgePercent,
  Boxes,
  Calculator,
  CircleDollarSign,
  ClipboardList,
  Coins,
  Landmark,
  Megaphone,
  Package,
  Percent,
  ShieldAlert,
  ShoppingCart,
  TrendingUp,
  Truck,
  Undo2,
  Wallet,
  XCircle,
} from 'lucide-vue-next';
import { computed, watch } from 'vue';

import MarketplaceFilter from '../components/MarketplaceFilter.vue';
import { FINANCE_FEATURE, KPI_GROUPS, MARKET_SOURCE_NOTE } from '../overview.domain';
import { useOverviewStore } from '../store/store.overview';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { KpiCard } from '@/components/ui/kpi-card';
import { PageHeader } from '@/components/ui/page-header';
import { useAuthStore } from '@/modules/auth/store/store.auth';
import { ICON_TONE_CLASS } from '@/modules/dashboard/dashboard.domain';
import { RangePicker, rangeLabel, rangeQuery } from '@/shared/period';

const ICON: Record<KpiKey, Component> = {
  revenue: ShoppingCart,
  orders: ClipboardList,
  units: Package,
  avgCheck: Calculator,
  cogs: Coins,
  commission: Percent,
  logistics: Truck,
  promotion: Megaphone,
  tax: Landmark,
  withholdings: ShieldAlert,
  returns: Undo2,
  cancelled: XCircle,
  gross: CircleDollarSign,
  operating: CircleDollarSign,
  net: TrendingUp,
  margin: BadgePercent,
  receivable: Wallet,
  stockValue: Boxes,
  inTransit: Truck,
};

const store = useOverviewStore();
const auth = useAuthStore();

const withMoney = computed(() => auth.me?.features?.[FINANCE_FEATURE] === true);
const ready = computed(() => auth.me !== null);

const groups = computed(() =>
  KPI_GROUPS.map((group) => ({
    ...group,
    kpis: group.kpis.filter((kpi) => kpi.source !== 'summary' || withMoney.value),
  })).filter((group) => group.kpis.length > 0),
);

const statusTone = computed(() => {
  const status = store.summary.data?.status;
  if (status === 'verified') return 'ok';
  return status === 'discrepancy' ? 'danger' : 'warn';
});

function targetOf(link: KpiLink): RouteLocationRaw | null {
  const range = store.range;
  if (link === 'stores') return { name: 'ym-stores' };
  if (link === 'cashflow') return { name: 'ym-finance', params: { tab: 'cashflow' } };
  return range ? { name: 'ym-finance', params: { tab: 'pnl' }, query: rangeQuery(range) } : null;
}

function choosePreset(next: RangePreset): void {
  store.choosePreset(next);
}

// Период меняет сводку и отмены; срез «сейчас» грузится один раз за заход.
watch(
  () =>
    ready.value && store.request ? `${store.request.range.from}:${store.request.range.to}` : null,
  (key, previous) => {
    if (key === null) return;
    if (previous === undefined || previous === null) store.load(withMoney.value);
    else store.loadPeriod(withMoney.value);
  },
  { immediate: true },
);

function viewOf(kpi: KpiMeta) {
  return store.kpis[kpi.key] ?? null;
}
</script>

<template>
  <PageHeader
    title="Обзор"
    description="Главные показатели всего кабинета за любой период — карточки ведут в «Финансы»"
  >
    <template #filters>
      <div class="flex w-full flex-col gap-3">
        <MarketplaceFilter
          :model-value="store.marketplace"
          @update:model-value="store.chooseMarketplace($event)"
        />
        <RangePicker
          :preset="store.preset"
          :custom="store.custom"
          @preset="choosePreset"
          @custom="store.chooseCustom($event)"
        />
      </div>
    </template>
  </PageHeader>

  <div class="flex flex-col gap-6">
    <div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span v-if="store.range" class="tnum">{{ rangeLabel(store.range) }}</span>
      <Badge v-if="withMoney && store.summary.data" :variant="statusTone">
        {{ store.summary.data.statusLabel }}
      </Badge>
      <span v-if="withMoney && store.summary.data && store.summary.data.status !== 'verified'">
        числа могут измениться, пока Маркет не закрыл период
      </span>
    </div>

    <Alert v-if="ready && !withMoney">
      Деньги, заказы и прибыль считаются по финансовому журналу — откройте «Финансы» у
      администратора. Пока видны только остатки, товары в пути и отмены.
    </Alert>

    <section
      v-for="group in groups"
      :key="group.key"
      :aria-label="group.title"
      class="flex flex-col gap-3"
    >
      <h2 class="text-sm font-semibold">
        {{ group.title }}
        <span
          v-if="group.key === 'money' || group.key === 'costs'"
          class="ml-2 text-xs font-normal text-muted-foreground"
        >
          {{
            group.key === 'money'
              ? `остатки и в пути — ${MARKET_SOURCE_NOTE}`
              : 'отмены — из заказов Маркета'
          }}
        </span>
      </h2>
      <div class="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-4">
        <KpiCard
          v-for="kpi in group.kpis"
          :key="kpi.key"
          :label="kpi.label"
          :icon="ICON[kpi.key]"
          :icon-class="ICON_TONE_CLASS[kpi.iconTone].icon"
          :icon-tile-class="ICON_TONE_CLASS[kpi.iconTone].tile"
          :to="targetOf(kpi.link)"
          :accent="kpi.accent"
          :value="viewOf(kpi)?.value ?? null"
          :caption="viewOf(kpi)?.caption"
          :tone="viewOf(kpi)?.tone"
          :is-loading="store[kpi.source].isLoading"
          :is-refreshing="store[kpi.source].isRefreshing"
          :saved-at="store[kpi.source].savedAt"
          :error="store[kpi.source].error"
          loading-text="Считаю…"
          @retry="store[kpi.source].retry()"
        />
      </div>
    </section>

    <Alert v-if="store.stocks.data?.problems.length">
      Не все магазины ответили:
      <span v-for="(p, i) in store.stocks.data.problems" :key="i">
        «{{ p.storeName }}» — {{ p.problem
        }}<template v-if="i < store.stocks.data.problems.length - 1">; </template>
      </span>
    </Alert>
  </div>
</template>
