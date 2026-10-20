<script setup lang="ts">
/**
 * Вкладка «Год» (TASK-146): выбор года, сводка с лимитами и прогнозом,
 * предупреждения, отчётные периоды со сверкой, уменьшения и параметры года.
 * Расчёт — фоновая задача; уменьшения грузятся при открытии вкладки.
 */
import type { TaxYearPeriodKey } from '../taxes.domain';

import { RotateCw } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed, onMounted, ref } from 'vue';

import { useTaxReconciliationDialog } from '../composables/useTaxReconciliationDialog.taxes';
import { useTaxReductionDialog } from '../composables/useTaxReductionDialog.taxes';
import {
  formatParam,
  taxYearOptions,
  toLimitBars,
  toPeriodRow,
  toReductionRow,
} from '../mappers/mapTaxYear.taxes';
import { useTaxesStore } from '../store/store.taxes';

import TaxPeriodsTable from './TaxPeriodsTable.vue';
import TaxReconciliationDialog from './TaxReconciliationDialog.vue';
import TaxReductionDialog from './TaxReductionDialog.vue';
import TaxReductionsCard from './TaxReductionsCard.vue';
import TaxYearSummary from './TaxYearSummary.vue';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { OptionGroup } from '@/components/ui/option-group';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { formatKopecks, moscowToday } from '@/shared/utils';

const store = useTaxesStore();
const {
  year,
  yearView,
  yearRefreshing,
  yearSavedAt,
  yearError,
  staffSaving,
  reductions,
  reductionsError,
} = storeToRefs(store);

const years = taxYearOptions(moscowToday());
const limits = computed(() => (yearView.value ? toLimitBars(yearView.value) : []));
const periodRows = computed(() =>
  yearView.value
    ? yearView.value.periods.map((p) => toPeriodRow(p, yearView.value?.reductionsApply ?? false))
    : [],
);
const reductionRows = computed(() => (reductions.value?.items ?? []).map(toReductionRow));
const kindOptions = computed(() =>
  (reductions.value?.kinds ?? []).map((k) => ({ value: k.key, label: k.label })),
);

const reduction = useTaxReductionDialog();
const reconciliation = useTaxReconciliationDialog();
const reconciliationTitle = computed(() =>
  reconciliation.period.value
    ? `Сверка: ${reconciliation.period.value.label} ${year.value}`
    : 'Сверка',
);
const reconciliationOurs = computed(() => {
  const period = reconciliation.period.value;
  return period
    ? { income: formatKopecks(period.incomeKopecks), due: formatKopecks(period.dueKopecks) }
    : null;
});

const busy = ref(false);
const disabled = computed(() => busy.value || staffSaving.value);

function openReconcile(key: TaxYearPeriodKey): void {
  const period = yearView.value?.periods.find((p) => p.key === key);
  if (period) reconciliation.show(period);
}

function findReduction(id: string) {
  return reductions.value?.items.find((r) => r.id === id) ?? null;
}

function editReduction(id: string): void {
  const found = findReduction(id);
  if (found) reduction.openEdit(found);
}

function removeReduction(id: string): void {
  const found = findReduction(id);
  if (found) reduction.askRemove(found);
}

async function setStaff(value: boolean): Promise<void> {
  try {
    await store.setStaff(value);
  } catch (e) {
    toast.error('Не удалось сохранить', e instanceof Error ? e.message : undefined);
  }
}

onMounted(() => {
  store.loadYear();
  if (reductions.value === null) void store.loadReductions();
});
</script>

<template>
  <div class="flex flex-col gap-6">
    <OptionGroup
      label="Налоговый год"
      :model-value="year"
      :options="years"
      @update:model-value="store.selectYear($event)"
    />

    <div v-if="yearError && !yearView" class="flex flex-col items-start gap-3">
      <Alert>{{ yearError }}</Alert>
      <Button variant="outline" @click="store.retryYear()">
        <RotateCw />
        Повторить
      </Button>
    </div>

    <div v-else-if="!yearView" class="flex flex-col gap-6" aria-busy="true">
      <Skeleton class="h-48 w-full" />
      <Skeleton class="h-64 w-full" />
    </div>

    <template v-else>
      <div class="relative">
        <RefreshIndicator :refreshing="yearRefreshing" :saved-at="yearSavedAt" :error="yearError" />
        <TaxYearSummary :view="yearView" :limits="limits" />
      </div>

      <div v-if="yearView.warnings.length" class="flex flex-col gap-2">
        <Alert
          v-for="warning in yearView.warnings"
          :key="warning.key"
          :variant="warning.level === 'exceeded' ? 'danger' : 'warn'"
        >
          {{ warning.text }}
        </Alert>
      </div>

      <TaxPeriodsTable
        :rows="periodRows"
        :reductions-apply="yearView.reductionsApply"
        :disabled="disabled"
        @reconcile="openReconcile"
      />
    </template>

    <Alert v-if="reductionsError">{{ reductionsError }}</Alert>
    <TaxReductionsCard
      v-else
      :rows="reductionRows"
      :reductions-apply="yearView?.reductionsApply ?? true"
      :has-staff="yearView?.hasStaff ?? false"
      :disabled="disabled"
      @add="reduction.openCreate()"
      @edit="editReduction"
      @remove="removeReduction"
      @staff="setStaff"
    />

    <Card v-if="yearView">
      <CardHeader>
        <CardTitle>Параметры {{ yearView.year }} года</CardTitle>
        <CardDescription>
          {{ yearView.params?.sourceNote ?? 'Параметры года не заданы — их вносит администратор.' }}
        </CardDescription>
      </CardHeader>
      <CardContent v-if="yearView.params">
        <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div
            v-for="item in yearView.params.items"
            :key="item.key"
            class="flex justify-between gap-4"
          >
            <dt class="text-muted-foreground">{{ item.label }}</dt>
            <dd class="whitespace-nowrap tabular-nums">{{ formatParam(item) }}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>

    <TaxReductionDialog
      v-model:open="reduction.open.value"
      v-model:form="reduction.form.value"
      :title="reduction.title.value"
      :kinds="kindOptions"
      :note-max-length="reductions?.noteMaxLength ?? 200"
      :errors="reduction.errors.value"
      :busy="reduction.busy.value"
      @save="reduction.save()"
    />
    <ConfirmDialog
      v-model:open="reduction.removeOpen.value"
      title="Удалить уменьшение?"
      :description="
        reduction.removing.value
          ? `${reduction.removing.value.kindLabel} — год пересчитается`
          : undefined
      "
      confirm-label="Удалить"
      destructive
      :busy="reduction.busy.value"
      @confirm="reduction.confirmRemove()"
    />
    <TaxReconciliationDialog
      v-model:open="reconciliation.open.value"
      v-model:form="reconciliation.form.value"
      :title="reconciliationTitle"
      :ours="reconciliationOurs"
      :errors="reconciliation.errors.value"
      :busy="reconciliation.busy.value"
      @save="reconciliation.save()"
    />
  </div>
</template>
