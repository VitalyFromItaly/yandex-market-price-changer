<script setup lang="ts">
/**
 * Сколько расходов ложится в выбранный период — то же распределение, что
 * вычтет P&L. Ежемесячные — по дням своего месяца, разовые — целиком.
 */
import type { AllocationModel, AllocationPreset } from '../expenses.domain';

import { ALLOCATION_PRESETS } from '../mappers/mapAllocation.expenses';

import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { OptionGroup } from '@/components/ui/option-group';
import { Skeleton } from '@/components/ui/skeleton';

defineProps<{
  model: AllocationModel | null;
  preset: AllocationPreset;
  error: string | null;
  loading: boolean;
}>();
const emit = defineEmits<{ choose: [AllocationPreset] }>();
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Расходы за период</CardTitle>
      <CardDescription>
        {{ model ? model.rangeLabel : 'Ежемесячные — по дням своего месяца, разовые — целиком' }}
      </CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-4">
      <OptionGroup
        label="Период"
        :model-value="preset"
        :options="ALLOCATION_PRESETS"
        :disabled="loading"
        @update:model-value="emit('choose', $event)"
      />

      <Alert v-if="error">{{ error }}</Alert>
      <Skeleton v-else-if="!model" class="h-16 w-full" />
      <template v-else>
        <div class="text-3xl font-semibold tabular-nums" :aria-busy="loading">
          {{ model.total }}
        </div>
        <p v-if="model.isEmpty" class="text-sm text-muted-foreground">
          В этот период расходов нет.
        </p>
        <dl v-else class="grid gap-1 text-sm">
          <div v-for="row in model.byCategory" :key="row.key" class="flex justify-between gap-4">
            <dt class="text-muted-foreground">{{ row.label }}</dt>
            <dd class="tabular-nums">{{ row.amount }}</dd>
          </div>
        </dl>
      </template>
    </CardContent>
  </Card>
</template>
