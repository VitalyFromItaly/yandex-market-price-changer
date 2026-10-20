<script setup lang="ts">
/**
 * «Расходы»: операционные расходы бизнеса — аренда, зарплаты, упаковка, свои
 * категории. Наверху — сколько их ложится в период (то же распределение, что
 * вычтет P&L), ниже — записи и категории.
 */
import { Plus, Receipt, RotateCw } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed, onMounted } from 'vue';

import AllocationCard from '../components/AllocationCard.vue';
import CategoriesCard from '../components/CategoriesCard.vue';
import ExpenseDialog from '../components/ExpenseDialog.vue';
import ExpensesTable from '../components/ExpensesTable.vue';
import { useExpenseDialog } from '../composables/useExpenseDialog.expenses';
import { useExpenseRemoval } from '../composables/useExpenseRemoval.expenses';
import { toAllocationModel } from '../mappers/mapAllocation.expenses';
import { categoryOptions, toExpenseRow } from '../mappers/mapExpenses.expenses';
import { useExpensesStore } from '../store/store.expenses';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';

const store = useExpensesStore();
const { view, error, allocation, preset, allocationError, allocationLoading } = storeToRefs(store);

const dialog = useExpenseDialog();
const removal = useExpenseRemoval();

const rows = computed(() => (view.value ? view.value.expenses.map(toExpenseRow) : []));
const options = computed(() => (view.value ? categoryOptions(view.value.categories) : []));
const allocationModel = computed(() =>
  allocation.value ? toAllocationModel(allocation.value) : null,
);

const removingCategory = computed(() => removal.target.value?.kind === 'category');
const removalTitle = computed(() =>
  removingCategory.value ? 'Удалить категорию?' : 'Удалить расход?',
);
const removalDescription = computed(() =>
  removingCategory.value
    ? 'Категория пропадёт из списка. Занятую записями удалить нельзя.'
    : 'Запись исчезнет из расчёта за все периоды.',
);

function edit(id: string): void {
  const expense = view.value?.expenses.find((row) => row.id === id);
  if (expense !== undefined) dialog.openEdit(expense);
}

function remove(id: string): void {
  const expense = view.value?.expenses.find((row) => row.id === id);
  if (expense !== undefined) removal.askExpense(expense);
}

onMounted(() => {
  void store.load();
  void store.refresh();
});
</script>

<template>
  <PageHeader title="Расходы" description="Операционные расходы бизнеса — для прибыли за период">
    <template #actions>
      <Button :disabled="!view" @click="dialog.openCreate()">
        <Plus />
        Добавить расход
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
    <Skeleton class="h-40 w-full" />
    <Skeleton class="h-64 w-full" />
  </div>

  <div v-else class="flex max-w-4xl flex-col gap-6">
    <AllocationCard
      :model="allocationModel"
      :preset="preset"
      :error="allocationError"
      :loading="allocationLoading"
      @choose="store.choose($event)"
    />

    <EmptyState
      v-if="rows.length === 0"
      :icon="Receipt"
      title="Расходов пока нет"
      description="Добавьте аренду, зарплаты или упаковку — они вычтутся из прибыли за период."
    />
    <ExpensesTable
      v-else
      :rows="rows"
      :disabled="dialog.busy.value || removal.busy.value"
      @edit="edit"
      @remove="remove"
    />

    <CategoriesCard
      :categories="view.categories"
      :name-max-length="view.limits.categoryNameMaxLength"
      @remove="removal.askCategory($event)"
    />
  </div>

  <ExpenseDialog
    v-if="view"
    v-model:open="dialog.open.value"
    v-model:form="dialog.form.value"
    :title="dialog.title.value"
    :categories="options"
    :note-max-length="view.limits.noteMaxLength"
    :errors="dialog.errors.value"
    :busy="dialog.busy.value"
    @save="dialog.save()"
  />

  <ConfirmDialog
    v-model:open="removal.open.value"
    :title="removalTitle"
    :description="removalDescription"
    confirm-label="Удалить"
    destructive
    :busy="removal.busy.value"
    @confirm="removal.confirm()"
  />
</template>
