<script setup lang="ts">
/**
 * Режим себестоимости А/Б (TASK-216, API — TASK-215): выбор — через
 * подтверждение «меняется только новый учёт»; текущий расчёт не трогается.
 */
import { onMounted } from 'vue';

import {
  COST_METHOD_SWITCH_WARNING,
  useCostMethodSwitch,
} from '../composables/useCostMethodSwitch.accounting';
import { useAccountingStore } from '../store/store.accounting';

import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { OptionGroup } from '@/components/ui/option-group';
import { Skeleton } from '@/components/ui/skeleton';

const store = useAccountingStore();
const switcher = useCostMethodSwitch();

onMounted(() => void store.loadCostSettings());
</script>

<template>
  <Card class="flex flex-col gap-3 p-4">
    <div>
      <h3 class="text-sm font-semibold">Режим себестоимости</h3>
      <p class="text-sm text-muted-foreground">
        Как «Финучёт» считает себестоимость проданного товара. {{ COST_METHOD_SWITCH_WARNING }}
      </p>
    </div>

    <Alert v-if="store.costSettingsError">
      Режим не загрузился: {{ store.costSettingsError }}. Обновите страницу чуть позже.
    </Alert>
    <Skeleton v-else-if="!store.costSettings" class="h-9 w-80" />
    <template v-else>
      <OptionGroup
        :model-value="switcher.current.value"
        :options="switcher.options.value"
        label="Режим себестоимости"
        :disabled="switcher.busy.value"
        @update:model-value="switcher.choose"
      />
      <p v-if="store.costSettings.isDefault" class="text-xs text-muted-foreground">
        Выбран по умолчанию — продавец режим ещё не менял.
      </p>
      <p v-if="switcher.error.value" class="text-sm text-danger" role="alert">
        {{ switcher.error.value }}
      </p>
    </template>

    <ConfirmDialog
      v-model:open="switcher.open.value"
      :title="switcher.confirmTitle.value"
      :description="COST_METHOD_SWITCH_WARNING"
      confirm-label="Сменить режим"
      :busy="switcher.busy.value"
      @confirm="switcher.confirm"
    />
  </Card>
</template>
