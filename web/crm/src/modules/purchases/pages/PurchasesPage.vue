<script setup lang="ts">
/**
 * «Закупки»: закупки партий и уплаченные налоги. Закупка меняет движение
 * денег, но не чистую прибыль; ДДС с выплатами и деньгами к получению — в
 * разделе «Финансы» (TASK-124, решение finance_crm_cashflow_moved).
 */
import { PackagePlus, Plus, RotateCw } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed, onMounted } from 'vue';

import PurchaseDialog from '../components/PurchaseDialog.vue';
import PurchasesTable from '../components/PurchasesTable.vue';
import TaxPaymentDialog from '../components/TaxPaymentDialog.vue';
import TaxPaymentsCard from '../components/TaxPaymentsCard.vue';
import { usePurchaseDialog } from '../composables/usePurchaseDialog.purchases';
import { usePurchaseRemoval } from '../composables/usePurchaseRemoval.purchases';
import { useTaxPaymentDialog } from '../composables/useTaxPaymentDialog.purchases';
import { toPurchaseRow, toTaxPaymentRow } from '../mappers/mapPurchases.purchases';
import { usePurchasesStore } from '../store/store.purchases';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';

const store = usePurchasesStore();
const { view, error } = storeToRefs(store);

const dialog = usePurchaseDialog();
const taxDialog = useTaxPaymentDialog();
const removal = usePurchaseRemoval();

const rows = computed(() => (view.value ? view.value.purchases.map(toPurchaseRow) : []));
const taxRows = computed(() => (view.value ? view.value.taxPayments.map(toTaxPaymentRow) : []));
const busy = computed(() => dialog.busy.value || taxDialog.busy.value || removal.busy.value);

function find<T extends { id: string }>(list: readonly T[] | undefined, id: string): T | undefined {
  return list?.find((row) => row.id === id);
}

function editPurchase(id: string): void {
  const purchase = find(view.value?.purchases, id);
  if (purchase !== undefined) dialog.openEdit(purchase);
}

function removePurchase(id: string): void {
  const purchase = find(view.value?.purchases, id);
  if (purchase !== undefined) removal.askPurchase(purchase);
}

function editTax(id: string): void {
  const payment = find(view.value?.taxPayments, id);
  if (payment !== undefined) taxDialog.openEdit(payment);
}

function removeTax(id: string): void {
  const payment = find(view.value?.taxPayments, id);
  if (payment !== undefined) removal.askTax(payment);
}

onMounted(() => {
  void store.load();
});
</script>

<template>
  <PageHeader title="Закупки" description="Закупки партий и уплаченные налоги">
    <template #actions>
      <Button :disabled="!view" @click="dialog.openCreate()">
        <Plus />
        Добавить закупку
      </Button>
    </template>
  </PageHeader>

  <div v-if="error && !view" class="flex flex-col items-start gap-3">
    <Alert>{{ error }}</Alert>
    <Button variant="outline" @click="store.load()">
      <RotateCw />
      Повторить
    </Button>
  </div>

  <div v-else-if="!view" class="flex max-w-4xl flex-col gap-6" aria-busy="true">
    <Skeleton class="h-64 w-full" />
    <Skeleton class="h-32 w-full" />
  </div>

  <div v-else class="flex max-w-4xl flex-col gap-6">
    <EmptyState
      v-if="rows.length === 0"
      :icon="PackagePlus"
      title="Закупок пока нет"
      description="Внесите оплату партии — она попадёт в движение денег, а прибыль не изменит."
    />
    <PurchasesTable
      v-else
      :rows="rows"
      :disabled="busy"
      @edit="editPurchase"
      @remove="removePurchase"
    />

    <TaxPaymentsCard
      :rows="taxRows"
      :disabled="busy"
      @add="taxDialog.openCreate()"
      @edit="editTax"
      @remove="removeTax"
    />
  </div>

  <template v-if="view">
    <PurchaseDialog
      v-model:open="dialog.open.value"
      v-model:form="dialog.form.value"
      :title="dialog.title.value"
      :limits="view.limits"
      :errors="dialog.errors.value"
      :busy="dialog.busy.value"
      @save="dialog.save()"
    />
    <TaxPaymentDialog
      v-model:open="taxDialog.open.value"
      v-model:form="taxDialog.form.value"
      :title="taxDialog.title.value"
      :note-max-length="view.limits.noteMaxLength"
      :errors="taxDialog.errors.value"
      :busy="taxDialog.busy.value"
      @save="taxDialog.save()"
    />
  </template>

  <ConfirmDialog
    v-model:open="removal.open.value"
    :title="removal.title.value"
    description="Запись исчезнет из движения денег в «Финансах» за все периоды."
    confirm-label="Удалить"
    destructive
    :busy="removal.busy.value"
    @confirm="removal.confirm()"
  />
</template>
