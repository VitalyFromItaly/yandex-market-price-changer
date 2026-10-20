<script setup lang="ts">
/**
 * Налоговые настройки — одна форма и одна кнопка «Сохранить». Ставку и выбор
 * проверяет сервер; ошибка встаёт под своё поле.
 */
import type { TaxesView } from '../taxes.domain';

import { computed } from 'vue';

import { useTaxForm } from '../composables/useTaxForm.taxes';
import { formatRate, recognitionOptions, regimeOptions } from '../mappers/mapTaxes.taxes';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form } from '@/components/ui/form';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { OptionGroup } from '@/components/ui/option-group';

const props = defineProps<{ view: TaxesView }>();

const { form, errors, busy, dirty, chooseRegime, submit, discard } = useTaxForm();

const regimes = computed(() => regimeOptions(props.view));
const recognitions = computed(() => recognitionOptions(props.view));
const maxRate = computed(() => {
  const regime = props.view.regimes.find((item) => item.key === form.value?.regime);
  return regime?.maxRateBasisPoints ?? null;
});
const withExpenses = computed(() => form.value?.regime === 'usn_income_minus_expenses');
</script>

<template>
  <Form v-if="form" class="gap-6" @submit="submit">
    <Card>
      <CardHeader>
        <CardTitle>Режим налогообложения</CardTitle>
        <CardDescription>
          База — ваш доход от продаж до комиссий и услуг площадки, а не сумма выплат.
        </CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-4">
        <OptionGroup
          :model-value="form.regime"
          :options="regimes"
          label="Режим налогообложения"
          :disabled="busy"
          @update:model-value="chooseRegime"
        />
        <p v-if="errors.regime" class="text-sm text-danger" role="alert">{{ errors.regime }}</p>
        <p v-if="withExpenses" class="text-sm text-muted-foreground">
          Если налог от разницы окажется меньше
          {{ formatRate(view.minimumTaxBasisPoints) }} % от доходов, начисляется минимальный налог.
        </p>

        <FormField
          id="tax-rate"
          v-slot="{ attrs }"
          :label="maxRate === null ? 'Ставка, %' : `Ставка, % (не выше ${formatRate(maxRate)})`"
          :error="errors.rate"
        >
          <Input
            v-bind="attrs"
            v-model="form.rate"
            class="max-w-32"
            inputmode="decimal"
            :disabled="busy"
          />
        </FormField>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Дата признания дохода</CardTitle>
        <CardDescription>
          На УСН доход признаётся в день поступления денег — так по умолчанию.
        </CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-2">
        <OptionGroup
          v-model="form.recognition"
          :options="recognitions"
          label="Дата признания дохода"
          :disabled="busy"
        />
        <p v-if="errors.recognition" class="text-sm text-danger" role="alert">
          {{ errors.recognition }}
        </p>
      </CardContent>
    </Card>

    <Alert v-if="errors.form">{{ errors.form }}</Alert>

    <div class="flex flex-wrap items-center gap-2">
      <Button type="submit" :disabled="busy || !dirty">
        {{ busy ? 'Сохраняем…' : 'Сохранить' }}
      </Button>
      <Button
        v-if="dirty && !view.isDefault"
        type="button"
        variant="outline"
        :disabled="busy"
        @click="discard"
      >
        Отменить
      </Button>
      <span v-if="view.isDefault" class="text-sm text-muted-foreground">
        Сейчас действуют настройки по умолчанию — сохраните, чтобы подтвердить их.
      </span>
    </div>
  </Form>
</template>
