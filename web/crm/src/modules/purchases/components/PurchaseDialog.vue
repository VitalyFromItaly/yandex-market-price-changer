<script setup lang="ts">
/**
 * Форма закупки: поставщик, дата оплаты, сумма, комментарий и необязательные
 * позиции. Закупка — движение денег, на прибыль не влияет.
 */
import type { PurchaseErrors, PurchaseForm } from '../purchases.domain';

import PurchaseLinesField from './PurchaseLinesField.vue';

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

defineProps<{
  title: string;
  limits: { supplierMaxLength: number; noteMaxLength: number; linesMax: number };
  errors: PurchaseErrors;
  busy: boolean;
}>();
const open = defineModel<boolean>('open', { default: false });
const form = defineModel<PurchaseForm>('form', { required: true });
const emit = defineEmits<{ save: [] }>();

/** Поле меняется заменой объекта, а не мутацией чужого состояния. */
function set<K extends keyof PurchaseForm>(key: K, value: PurchaseForm[K]): void {
  form.value = { ...form.value, [key]: value };
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>
          Ляжет в движение денег в день оплаты. Чистую прибыль не меняет — себестоимость считается
          по продажам.
        </DialogDescription>
      </DialogHeader>

      <Form @submit="emit('save')">
        <FormField
          id="purchase-supplier"
          v-slot="{ attrs }"
          label="Поставщик"
          :error="errors.supplier"
        >
          <Input
            v-bind="attrs"
            :model-value="form.supplier"
            :maxlength="limits.supplierMaxLength"
            placeholder="ООО «Восток»"
            :disabled="busy"
            @update:model-value="set('supplier', String($event))"
          />
        </FormField>

        <div class="grid gap-4 sm:grid-cols-2">
          <FormField
            id="purchase-day"
            v-slot="{ attrs }"
            label="Дата оплаты"
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
            id="purchase-amount"
            v-slot="{ attrs }"
            label="Сумма, ₽"
            :error="errors.amount"
          >
            <Input
              v-bind="attrs"
              :model-value="form.amount"
              inputmode="decimal"
              placeholder="150000"
              :disabled="busy"
              @update:model-value="set('amount', String($event))"
            />
          </FormField>
        </div>

        <PurchaseLinesField
          :model-value="form.lines"
          :max="limits.linesMax"
          :busy="busy"
          :error="errors.lines"
          @update:model-value="set('lines', $event)"
        />

        <FormField id="purchase-note" v-slot="{ attrs }" label="Комментарий" :error="errors.note">
          <Input
            v-bind="attrs"
            :model-value="form.note"
            :maxlength="limits.noteMaxLength"
            placeholder="Необязательно"
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
