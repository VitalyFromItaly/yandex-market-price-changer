<script setup lang="ts">
/** Форма уменьшения налога: дата уплаты, вид, сумма, комментарий. */
import type { TaxReductionForm, TaxReductionKind, TaxYearErrors } from '../taxes.domain';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Form } from '@/components/ui/form';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { OptionGroup } from '@/components/ui/option-group';

defineProps<{
  title: string;
  kinds: { value: TaxReductionKind; label: string }[];
  noteMaxLength: number;
  errors: TaxYearErrors;
  busy: boolean;
}>();
const open = defineModel<boolean>('open', { default: false });
const form = defineModel<TaxReductionForm>('form', { required: true });
const emit = defineEmits<{ save: [] }>();

function set<K extends keyof TaxReductionForm>(key: K, value: TaxReductionForm[K]): void {
  form.value = { ...form.value, [key]: value };
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>Уменьшит налог отчётного периода, в котором уплачено.</DialogDescription>
      </DialogHeader>

      <Form @submit="emit('save')">
        <FormField id="reduction-kind" label="Вид" :error="errors.kind">
          <OptionGroup
            label="Вид уменьшения"
            :model-value="form.kind"
            :options="kinds"
            :disabled="busy"
            @update:model-value="set('kind', $event)"
          />
        </FormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <FormField
            id="reduction-day"
            v-slot="{ attrs }"
            label="Дата уплаты"
            :error="errors.paidDay"
          >
            <Input
              v-bind="attrs"
              type="date"
              :model-value="form.paidDay"
              :disabled="busy"
              @update:model-value="set('paidDay', String($event))"
            />
          </FormField>
          <FormField
            id="reduction-amount"
            v-slot="{ attrs }"
            label="Сумма, ₽"
            :error="errors.amount"
          >
            <Input
              v-bind="attrs"
              :model-value="form.amount"
              inputmode="decimal"
              placeholder="57390"
              :disabled="busy"
              @update:model-value="set('amount', String($event))"
            />
          </FormField>
        </div>
        <FormField id="reduction-note" v-slot="{ attrs }" label="Комментарий" :error="errors.note">
          <Input
            v-bind="attrs"
            :model-value="form.note"
            :maxlength="noteMaxLength"
            placeholder="Например, взносы за I квартал"
            :disabled="busy"
            @update:model-value="set('note', String($event))"
          />
        </FormField>

        <Alert v-if="errors.form">{{ errors.form }}</Alert>

        <DialogFooter>
          <Button type="button" variant="outline" :disabled="busy" @click="open = false"
            >Отмена</Button
          >
          <Button type="submit" :disabled="busy">{{ busy ? 'Сохраняем…' : 'Сохранить' }}</Button>
        </DialogFooter>
      </Form>
    </DialogContent>
  </Dialog>
</template>
