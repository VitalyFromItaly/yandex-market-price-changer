<script setup lang="ts">
/**
 * Сверка отчётного периода с бухгалтерией: что насчитал бухгалтер и отметка
 * «сверено». Расхождение считает сервер — экран показывает его в таблице.
 */
import type { TaxReconciliationForm, TaxYearErrors } from '../taxes.domain';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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

defineProps<{
  title: string;
  ours: { income: string; due: string } | null;
  errors: TaxYearErrors;
  busy: boolean;
}>();
const open = defineModel<boolean>('open', { default: false });
const form = defineModel<TaxReconciliationForm>('form', { required: true });
const emit = defineEmits<{ save: [] }>();

function set<K extends keyof TaxReconciliationForm>(key: K, value: TaxReconciliationForm[K]): void {
  form.value = { ...form.value, [key]: value };
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription v-if="ours">
          У нас: доход {{ ours.income }}, налог к уплате {{ ours.due }}.
        </DialogDescription>
      </DialogHeader>

      <Form @submit="emit('save')">
        <div class="grid gap-4 sm:grid-cols-2">
          <FormField
            id="rec-income"
            v-slot="{ attrs }"
            label="Доход у бухгалтера, ₽"
            :error="errors.accountantIncome"
          >
            <Input
              v-bind="attrs"
              :model-value="form.accountantIncome"
              inputmode="decimal"
              :disabled="busy"
              @update:model-value="set('accountantIncome', String($event))"
            />
          </FormField>
          <FormField
            id="rec-tax"
            v-slot="{ attrs }"
            label="Налог у бухгалтера, ₽"
            :error="errors.accountantTax"
          >
            <Input
              v-bind="attrs"
              :model-value="form.accountantTax"
              inputmode="decimal"
              :disabled="busy"
              @update:model-value="set('accountantTax', String($event))"
            />
          </FormField>
        </div>
        <FormField id="rec-note" v-slot="{ attrs }" label="Комментарий" :error="errors.note">
          <Input
            v-bind="attrs"
            :model-value="form.note"
            :disabled="busy"
            @update:model-value="set('note', String($event))"
          />
        </FormField>
        <Checkbox
          label="Сверено с бухгалтерией"
          :model-value="form.checked"
          :disabled="busy"
          @update:model-value="set('checked', $event)"
        />

        <Alert v-if="errors.form || errors.checked">{{ errors.form ?? errors.checked }}</Alert>

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
