<script setup lang="ts">
/** Форма уплаты налога: дата, сумма, комментарий. */
import type { PurchaseErrors, TaxPaymentForm } from '../purchases.domain';

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

defineProps<{ title: string; noteMaxLength: number; errors: PurchaseErrors; busy: boolean }>();
const open = defineModel<boolean>('open', { default: false });
const form = defineModel<TaxPaymentForm>('form', { required: true });
const emit = defineEmits<{ save: [] }>();

function set<K extends keyof TaxPaymentForm>(key: K, value: TaxPaymentForm[K]): void {
  form.value = { ...form.value, [key]: value };
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>Ляжет в движение денег в день уплаты.</DialogDescription>
      </DialogHeader>

      <Form @submit="emit('save')">
        <div class="grid gap-4 sm:grid-cols-2">
          <FormField id="tax-day" v-slot="{ attrs }" label="Дата уплаты" :error="errors.paidDay">
            <Input
              v-bind="attrs"
              type="date"
              :model-value="form.paidDay"
              :disabled="busy"
              @update:model-value="set('paidDay', String($event))"
            />
          </FormField>
          <FormField id="tax-amount" v-slot="{ attrs }" label="Сумма, ₽" :error="errors.amount">
            <Input
              v-bind="attrs"
              :model-value="form.amount"
              inputmode="decimal"
              placeholder="12000"
              :disabled="busy"
              @update:model-value="set('amount', String($event))"
            />
          </FormField>
        </div>
        <FormField id="tax-note" v-slot="{ attrs }" label="Комментарий" :error="errors.note">
          <Input
            v-bind="attrs"
            :model-value="form.note"
            :maxlength="noteMaxLength"
            placeholder="Например, аванс УСН за III квартал"
            :disabled="busy"
            @update:model-value="set('note', String($event))"
          />
        </FormField>

        <Alert v-if="errors.form">{{ errors.form }}</Alert>

        <DialogFooter>
          <Button type="button" variant="outline" :disabled="busy" @click="open = false">
            Отмена
          </Button>
          <Button type="submit" :disabled="busy">{{ busy ? 'Сохраняем…' : 'Сохранить' }}</Button>
        </DialogFooter>
      </Form>
    </DialogContent>
  </Dialog>
</template>
