<script setup lang="ts">
/**
 * «Установка цен» (TASK-203): наценка от закупа по площадке или файл «артикул |
 * цена» → план «было → станет» по площадкам → снятие строк → запись с
 * подтверждением. План, риск и «что запишется» считает сервер (TASK-202);
 * страница собирает ввод, снятые строки и показывает итог.
 */
import { BadgePercent, Send } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';

import MethodCard from '../components/MethodCard.vue';
import PlanBlock from '../components/PlanBlock.vue';
import { usePlanForm } from '../composables/usePlanForm.price-set';
import { usePriceSetSelection } from '../composables/usePriceSetSelection.price-set';
import { PRICE_SET_FEATURE } from '../price-set.domain';
import { usePriceSetStore } from '../store/store.price-set';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { useAuthStore } from '@/modules/auth/store/store.auth';
import { formatMoscowDate } from '@/shared/utils';

const auth = useAuthStore();
const store = usePriceSetStore();
const {
  plan,
  planLoading,
  hasPlanRequest,
  planErrors,
  isApplySubmitting,
  isWriting,
  priceListDay: lastPriceListDay,
} = storeToRefs(store);
const form = usePlanForm();
const selection = usePriceSetSelection(plan);

const open = computed(() => auth.me?.features[PRICE_SET_FEATURE] === true);
const busy = computed(() => planLoading.value || isApplySubmitting.value || isWriting.value);
// Дата из плана свежее; до первого плана — из списка закупа («24-09-2026»).
const priceListDay = computed(() => {
  const at = plan.value?.priceListAt;
  return at ? formatMoscowDate(at) : lastPriceListDay.value;
});

watch(
  () => open.value && form.markupOpen.value,
  (ok) => {
    if (ok) void store.ensurePriceListDay();
  },
  { immediate: true },
);
const canWrite = computed(() => plan.value?.writeOpen === true && selection.count.value > 0);
const confirmOpen = ref(false);

async function submit(): Promise<void> {
  form.touch();
  if (!form.canSubmit.value) return;
  if (form.mode.value === 'markup') await store.planByMarkup(form.markups.value);
  else if (form.file.value) await store.planByFile(form.file.value, form.fileMarketplaces.value);
}

function selectFile(file: File | null): void {
  form.file.value = file;
  store.clearFileError();
}

async function confirmWrite(): Promise<void> {
  await store.apply(selection.marketplaces.value, selection.excludedKeys.value);
  confirmOpen.value = false;
}
</script>

<template>
  <PageHeader
    title="Установка цен"
    description="Цены на площадки — наценкой от закупа или файлом, с проверкой «было → станет»"
  >
    <template v-if="open && plan?.writeOpen" #actions>
      <Button :disabled="!canWrite || busy" @click="confirmOpen = true">
        <Send />
        Записать цены ({{ selection.count.value }})
      </Button>
    </template>
  </PageHeader>

  <EmptyState
    v-if="!open"
    :icon="BadgePercent"
    title="Установка цен закрыта"
    description="Её открывает администратор бота. Напишите ему, если она вам нужна."
  />

  <div v-else class="flex flex-col gap-4">
    <MethodCard
      :mode="form.mode.value"
      :markup-open="form.markupOpen.value"
      :rows="form.rows.value"
      :row-errors="form.rowErrors.value"
      :price-list-day="priceListDay"
      :marketplaces="form.marketplaces.value"
      :file-marketplaces="form.fileMarketplaces.value"
      :file="form.file.value"
      :file-error="planErrors.file"
      :disabled="busy"
      :can-submit="form.canSubmit.value"
      @update:mode="form.setMode"
      @update:row="form.setRow"
      @update:file="selectFile"
      @toggle-file-marketplace="form.toggleFileMarketplace"
      @submit="submit"
    />

    <Alert v-if="planErrors.form">{{ planErrors.form }}</Alert>

    <PlanBlock
      v-if="hasPlanRequest || plan"
      :options="selection.options.value"
      :is-selected="selection.isSelected"
      :is-included="selection.isIncluded"
      :count-of="selection.countOf"
      @toggle="selection.toggle"
      @toggle-row="selection.toggleRow"
    />
  </div>

  <ConfirmDialog
    v-model:open="confirmOpen"
    title="Записать цены на площадки?"
    :description="selection.confirmDescription.value"
    confirm-label="Записать"
    :busy="isApplySubmitting || isWriting"
    @confirm="confirmWrite"
  />
</template>
