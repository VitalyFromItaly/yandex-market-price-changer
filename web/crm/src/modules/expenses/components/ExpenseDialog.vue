<script setup lang="ts">
/**
 * Форма расхода: вид, категория, сумма, даты, источник, комментарий. Поля дат —
 * по виду: у разового один день, у ежемесячного начало и необязательный конец,
 * у «за период» — начало и конец. Привязка к площадке/заказу/товару (TASK-220)
 * видна, когда открыт «Финучёт» (`showBinding`): её читает только он.
 */
import type {
  ExpenseErrors,
  ExpenseForm,
  ExpenseKind,
  ExpenseMarketplace,
  ExpenseScope,
} from '../expenses.domain';

import { KIND_OPTIONS, MARKETPLACE_OPTIONS } from '../mappers/mapExpenses.expenses';

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
  categories: readonly { value: string; label: string }[];
  scopes: readonly { value: ExpenseScope; label: string }[];
  noteMaxLength: number;
  sourceMaxLength: number;
  refMaxLength: number;
  showBinding: boolean;
  errors: ExpenseErrors;
  busy: boolean;
}>();
const open = defineModel<boolean>('open', { default: false });
const form = defineModel<ExpenseForm>('form', { required: true });
const emit = defineEmits<{ save: [] }>();

/** Поле меняется заменой объекта, а не мутацией чужого состояния. */
function set<K extends keyof ExpenseForm>(key: K, value: ExpenseForm[K]): void {
  form.value = { ...form.value, [key]: value };
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>
          Ежемесячный расход ложится в период по дням своего месяца, расход за период — по дням
          периода.
        </DialogDescription>
      </DialogHeader>

      <Form @submit="emit('save')">
        <FormField id="expense-kind" label="Вид" :error="errors.kind">
          <OptionGroup
            label="Вид расхода"
            :model-value="form.kind"
            :options="KIND_OPTIONS"
            :disabled="busy"
            @update:model-value="set('kind', $event as ExpenseKind)"
          />
        </FormField>

        <FormField id="expense-category" label="Категория" :error="errors.category">
          <OptionGroup
            label="Категория"
            :model-value="form.category"
            :options="categories"
            :disabled="busy"
            @update:model-value="set('category', String($event))"
          />
        </FormField>

        <FormField
          id="expense-amount"
          v-slot="{ attrs }"
          :label="form.kind === 'monthly' ? 'Сумма в месяц, ₽' : 'Сумма, ₽'"
          :error="errors.amount"
        >
          <Input
            v-bind="attrs"
            :model-value="form.amount"
            inputmode="decimal"
            placeholder="30000"
            :disabled="busy"
            @update:model-value="set('amount', String($event))"
          />
        </FormField>

        <div class="grid gap-4 sm:grid-cols-2">
          <FormField
            id="expense-from"
            v-slot="{ attrs }"
            :label="form.kind === 'one_off' ? 'Дата' : 'Действует с'"
            :error="errors.fromDay"
          >
            <Input
              v-bind="attrs"
              type="date"
              :model-value="form.fromDay"
              :disabled="busy"
              @update:model-value="set('fromDay', String($event))"
            />
          </FormField>
          <FormField
            v-if="form.kind !== 'one_off'"
            id="expense-to"
            v-slot="{ attrs }"
            :label="form.kind === 'monthly' ? 'По (пусто — без конца)' : 'По'"
            :error="errors.toDay"
          >
            <Input
              v-bind="attrs"
              type="date"
              :model-value="form.toDay"
              :disabled="busy"
              @update:model-value="set('toDay', String($event))"
            />
          </FormField>
        </div>

        <template v-if="showBinding">
          <FormField id="expense-scope" label="К чему относится" :error="errors.scope">
            <OptionGroup
              label="К чему относится"
              :model-value="form.scope"
              :options="scopes"
              :disabled="busy"
              @update:model-value="set('scope', $event as ExpenseScope)"
            />
          </FormField>
          <FormField
            v-if="form.scope !== 'business'"
            id="expense-marketplace"
            :label="form.scope === 'product' ? 'Площадка (пусто — все)' : 'Площадка'"
            :error="errors.marketplace"
          >
            <OptionGroup
              label="Площадка"
              :model-value="form.marketplace"
              :options="MARKETPLACE_OPTIONS"
              :disabled="busy"
              @update:model-value="set('marketplace', $event as ExpenseMarketplace)"
            />
          </FormField>
          <FormField
            v-if="form.scope === 'order'"
            id="expense-order"
            v-slot="{ attrs }"
            label="Номер заказа"
            :error="errors.orderId"
          >
            <Input
              v-bind="attrs"
              :model-value="form.orderId"
              :maxlength="refMaxLength"
              :disabled="busy"
              @update:model-value="set('orderId', String($event))"
            />
          </FormField>
          <FormField
            v-if="form.scope === 'product'"
            id="expense-sku"
            v-slot="{ attrs }"
            label="Артикул товара"
            :error="errors.sku"
          >
            <Input
              v-bind="attrs"
              :model-value="form.sku"
              :maxlength="refMaxLength"
              :disabled="busy"
              @update:model-value="set('sku', String($event))"
            />
          </FormField>
        </template>

        <FormField id="expense-source" v-slot="{ attrs }" label="Источник" :error="errors.source">
          <Input
            v-bind="attrs"
            :model-value="form.source"
            :maxlength="sourceMaxLength"
            placeholder="Счёт, выписка, чек — необязательно"
            :disabled="busy"
            @update:model-value="set('source', String($event))"
          />
        </FormField>

        <FormField id="expense-note" v-slot="{ attrs }" label="Комментарий" :error="errors.note">
          <Input
            v-bind="attrs"
            :model-value="form.note"
            :maxlength="noteMaxLength"
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
