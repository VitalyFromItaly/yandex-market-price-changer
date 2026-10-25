<script setup lang="ts">
/**
 * «Обзор» (TASK-125, ТЗ п.1): главная по всему кабинету за любой период.
 * Деньги, заказы и штуки — из финжурнала тем же расчётом, что «Финансы»
 * (карточка ведёт в «Прибыль» с тем же периодом и там та же цифра); отмены,
 * остатки и товары в пути — срезы Маркета по всем магазинам кабинета.
 * Площадка — из адреса (TASK-183): /ozon/overview — журнал, остатки и заказы Ozon.
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

import {
  FINANCE_FEATURE,
  KPI_GROUPS,
  MARKETPLACE_SOURCE_LABEL,
  sourceNoteOf,
} from '../overview.domain';
import { useOverviewStore } from '../store/store.overview';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { KpiCard } from '@/components/ui/kpi-card';
import { PageHeader } from '@/components/ui/page-header';
import { useAuthStore } from '@/modules/auth/store/store.auth';
import { ICON_TONE_CLASS } from '@/modules/dashboard/dashboard.domain';
import { sectionName } from '@/navigation.sections';
import { useMarketplace } from '@/shared/composables';
import { JournalPull, useFinanceJournal } from '@/shared/finance-journal';
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

const routeMarketplace = useMarketplace();
const marketplace = computed(() => routeMarketplace.value ?? 'ym');
store.selectMarketplace(marketplace.value);

const closeNote = computed(() =>
  marketplace.value === 'ym'
    ? 'числа могут измениться, пока Маркет не закрыл период'
    : 'числа могут измениться, пока площадка не закрыла период',
);

const withMoney = computed(() => auth.me?.features?.[FINANCE_FEATURE] === true);
const ready = computed(() => auth.me !== null);

const journal = useFinanceJournal(
  () => (store.range ? { marketplace: marketplace.value, ...store.range } : null),
  () => store.loadPeriod(withMoney.value),
);
/** Журнал периода не загружен — денежных карточек нет: «0 ₽» читался бы как «продаж не было». */
const journalMissing = computed(() => journal.missing.value.length > 0);
const moneyShown = computed(() => withMoney.value && !journalMissing.value);

const groups = computed(() =>
  KPI_GROUPS.map((group) => ({
    ...group,
    kpis: group.kpis.filter((kpi) => kpi.source !== 'summary' || moneyShown.value),
  })).filter((group) => group.kpis.length > 0),
);

const statusTone = computed(() => {
  const status = store.summary.data?.status;
  if (status === 'verified') return 'ok';
  return status === 'discrepancy' ? 'danger' : 'warn';
});

function targetOf(link: KpiLink): RouteLocationRaw | null {
  const range = store.range;
  const finance = sectionName(marketplace.value, 'finance');
  // Магазины — только у ЯМ; у Ozon/WB карточке остатков ссылки нет.
  if (link === 'stores') return marketplace.value === 'ym' ? { name: 'ym-stores' } : null;
  if (link === 'cashflow') return { name: finance, params: { tab: 'cashflow' } };
  return range ? { name: finance, params: { tab: 'pnl' }, query: rangeQuery(range) } : null;
}

function choosePreset(next: RangePreset): void {
  store.choosePreset(next);
}

// Период меняет сводку и отмены; срез «сейчас» грузится один раз за заход и площадку.
watch(
  () =>
    ready.value && store.request
      ? {
          marketplace: marketplace.value,
          range: `${store.request.range.from}:${store.request.range.to}`,
        }
      : null,
  (key, previous) => {
    if (key === null) return;
    store.selectMarketplace(key.marketplace);
    if (!previous || previous.marketplace !== key.marketplace) store.load(withMoney.value);
    else if (previous.range !== key.range) store.loadPeriod(withMoney.value);
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
      <Badge v-if="moneyShown && store.summary.data" :variant="statusTone">
        {{ store.summary.data.statusLabel }}
      </Badge>
      <span v-if="moneyShown && store.summary.data && store.summary.data.status !== 'verified'">
        {{ closeNote }}
      </span>
    </div>

    <JournalPull v-if="withMoney" :journal="journal" />

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
              ? `остатки и в пути — ${sourceNoteOf(marketplace)}`
              : `отмены — из заказов ${MARKETPLACE_SOURCE_LABEL[marketplace]}`
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
      {{ marketplace === 'ym' ? 'Не все магазины ответили:' : 'Площадка ответила не на всё:' }}
      <span v-for="(p, i) in store.stocks.data.problems" :key="i">
        «{{ p.storeName }}» — {{ p.problem
        }}<template v-if="i < store.stocks.data.problems.length - 1">; </template>
      </span>
    </Alert>
  </div>
</template>
