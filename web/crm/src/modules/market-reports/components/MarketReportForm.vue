<script setup lang="ts">
/**
 * Параметры одного отчёта Маркета — поля по типу отчёта. Варианты приходят с
 * сервера (те же, что кнопки бота); значения — в сторе, форма их только
 * показывает и отдаёт изменения наверх.
 */
import type {
  MarketCategories,
  MarketReportForm,
  MarketReportKey,
  MarketReportsOptions,
} from '../market-reports.domain';

import { Alert } from '@/components/ui/alert';
import { FormField } from '@/components/ui/form-field';
import { OptionGroup } from '@/components/ui/option-group';
import { Skeleton } from '@/components/ui/skeleton';

defineProps<{
  report: MarketReportKey;
  form: MarketReportForm;
  options: MarketReportsOptions;
  categories: MarketCategories | null;
  categoriesLoading: boolean;
  categoriesError: string | null;
  disabled: boolean;
}>();
const emit = defineEmits<{
  change: [field: keyof MarketReportForm, value: string | number];
}>();
</script>

<template>
  <div class="grid gap-4">
    <FormField v-if="report === 'real'" id="mkt-month" label="Месяц">
      <OptionGroup
        :model-value="form.month"
        :options="options.months"
        label="Месяц"
        :disabled="disabled"
        @update:model-value="emit('change', 'month', $event)"
      />
    </FormField>

    <FormField v-if="report === 'comp'" id="mkt-category" label="Категория">
      <Skeleton v-if="categoriesLoading" class="h-8 w-full" />
      <Alert v-else-if="categoriesError">{{ categoriesError }}</Alert>
      <Alert v-else-if="categories?.emptyText">{{ categories.emptyText }}</Alert>
      <OptionGroup
        v-else-if="categories"
        :model-value="form.categoryId"
        :options="categories.options"
        label="Категория"
        :disabled="disabled"
        @update:model-value="emit('change', 'categoryId', $event)"
      />
    </FormField>

    <FormField
      v-if="report === 'comp' || report === 'shows' || report === 'geo'"
      id="mkt-period"
      label="Период"
    >
      <OptionGroup
        :model-value="form.period"
        :options="options.periods"
        label="Период"
        :disabled="disabled"
        @update:model-value="emit('change', 'period', $event)"
      />
    </FormField>

    <FormField v-if="report === 'shows'" id="mkt-grouping" label="Группировка">
      <OptionGroup
        :model-value="form.grouping"
        :options="options.groupings"
        label="Группировка"
        :disabled="disabled"
        @update:model-value="emit('change', 'grouping', $event)"
      />
    </FormField>

    <FormField v-if="report === 'key'" id="mkt-detalization" label="Детализация">
      <OptionGroup
        :model-value="form.detalization"
        :options="options.detalizations"
        label="Детализация"
        :disabled="disabled"
        @update:model-value="emit('change', 'detalization', $event)"
      />
    </FormField>

    <p v-if="report === 'turn'" class="text-sm text-muted-foreground">
      Параметров нет — Маркет считает оборачиваемость на сегодня.
    </p>
  </div>
</template>
