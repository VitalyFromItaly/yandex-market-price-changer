<script setup lang="ts">
/**
 * «Карантин цен»: товары, скрытые Маркетом с витрины из-за подозрительной
 * цены, и подтверждение — одной, отмеченных или всех. Список и запись —
 * тем же сервисом, что у бота; подтверждение только через диалог: это запись
 * в Маркет, и она действует на весь кабинет.
 */
import { CheckCheck, RotateCw, ShieldCheck } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed, watch } from 'vue';

import QuarantineTable from '../components/QuarantineTable.vue';
import { useQuarantineActions } from '../composables/useQuarantineActions.quarantine';
import { useQuarantineStore } from '../store/store.quarantine';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { useStoreKey } from '@/shared/composables';

const store = useQuarantineStore();
const { view, isLoading, isRefreshing, savedAt, loadError, isConfirming, confirmError } =
  storeToRefs(store);
const storeKey = useStoreKey();
const actions = useQuarantineActions(storeKey);
const { selected, allSelected, target, targetCount } = actions;

watch(
  storeKey,
  (key) => {
    if (key !== '') void store.load(key);
  },
  { immediate: true },
);

const rows = computed(() => view.value?.rows ?? []);
const busy = computed(() => isLoading.value || isConfirming.value);

const dialogTitle = computed(() => {
  if (target.value?.kind === 'one') return `Подтвердить цену ${target.value.offerId}?`;
  return `Подтвердить цены товаров: ${targetCount.value}?`;
});
const dialogDescription = computed(
  () =>
    'Маркет вернёт товары на витрину по текущей цене. ' +
    `${view.value?.note ?? ''} Если цена ошибочная — не подтверждайте, а исправьте её.`,
);
</script>

<template>
  <PageHeader title="Карантин цен" description="Товары, скрытые с витрины из-за цены">
    <template v-if="rows.length > 0" #actions>
      <Button
        v-if="selected.size > 0"
        variant="outline"
        :disabled="busy"
        @click="actions.ask({ kind: 'selected' })"
      >
        Подтвердить выбранные ({{ selected.size }})
      </Button>
      <Button :disabled="busy" @click="actions.ask({ kind: 'all' })">
        <CheckCheck />
        Подтвердить все ({{ rows.length }})
      </Button>
    </template>
  </PageHeader>

  <div v-if="loadError && !view" class="flex flex-col items-start gap-3">
    <Alert>{{ loadError }}</Alert>
    <Button variant="outline" @click="store.load(storeKey)">
      <RotateCw />
      Повторить
    </Button>
  </div>

  <Skeleton v-else-if="!view" class="h-72 w-full" aria-busy="true" />

  <div v-else class="flex flex-col gap-4">
    <Alert v-if="confirmError">{{ confirmError }}</Alert>
    <RefreshIndicator
      :refreshing="isRefreshing"
      :saved-at="savedAt"
      :error="loadError"
      @retry="store.load(storeKey)"
    />

    <EmptyState
      v-if="rows.length === 0"
      :icon="ShieldCheck"
      title="Карантин пуст"
      description="Все цены в порядке — Маркет ничего не скрыл с витрины."
    />

    <template v-else>
      <Alert variant="warn" class="whitespace-pre-line">
        {{ [...view.explainer, view.note].join('\n') }}
      </Alert>
      <QuarantineTable
        :rows="rows"
        :selected="selected"
        :all-selected="allSelected"
        :disabled="busy"
        :aria-busy="busy"
        @toggle="actions.toggle"
        @toggle-all="actions.toggleAll"
        @confirm="(offerId) => actions.ask({ kind: 'one', offerId })"
      />
    </template>
  </div>

  <ConfirmDialog
    v-model:open="actions.dialogOpen.value"
    :title="dialogTitle"
    :description="dialogDescription"
    confirm-label="Подтвердить"
    :busy="isConfirming"
    @confirm="actions.confirm()"
  />
</template>
