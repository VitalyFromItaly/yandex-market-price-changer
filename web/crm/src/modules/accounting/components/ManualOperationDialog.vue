<script setup lang="ts">
/**
 * Форма ручной операции (TASK-208): площадка, статья и подстатья, сумма со знаком,
 * дата, заказ/SKU, источник и номер документа. Источник обязателен — без него
 * операцию не отличить от выдумки при сверке.
 */
import type {
  ManualOperationErrors,
  ManualOperationForm,
  ManualOperationsView,
} from '../accounting.domain';

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
  options: ManualOperationsView['options'];
  limits: ManualOperationsView['limits'];
  errors: ManualOperationErrors;
  busy: boolean;
}>();
const open = defineModel<boolean>('open', { default: false });
const form = defineModel<ManualOperationForm>('form', { required: true });
const emit = defineEmits<{ save: [] }>();

/** Поле меняется заменой объекта, а не мутацией чужого состояния. */
function set<K extends keyof ManualOperationForm>(key: K, value: ManualOperationForm[K]): void {
  form.value = { ...form.value, [key]: value };
}

const SELECT =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
  'disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger';
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>
          Начисление, которого нет в отчётах площадки. Видно только «Финучёту» — «Финансы» его не
          считают.
        </DialogDescription>
      </DialogHeader>

      <Form @submit="emit('save')">
        <FormField id="manual-marketplace" label="Площадка" :error="errors.marketplace">
          <OptionGroup
            label="Площадка"
            :model-value="form.marketplace"
            :options="options.marketplaces.map((o) => ({ value: o.key, label: o.label }))"
            :disabled="busy"
            @update:model-value="set('marketplace', String($event))"
          />
        </FormField>

        <div class="grid gap-4 sm:grid-cols-2">
          <FormField id="manual-article" v-slot="{ attrs }" label="Статья" :error="errors.article">
            <select
              :id="attrs.id"
              :aria-describedby="attrs['aria-describedby']"
              :aria-invalid="attrs['aria-invalid'] === 'true' || undefined"
              :class="SELECT"
              :value="form.article"
              :disabled="busy"
              @change="set('article', ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="o in options.articles" :key="o.key" :value="o.key">
                {{ o.label }}
              </option>
            </select>
          </FormField>
          <FormField
            id="manual-sub-article"
            v-slot="{ attrs }"
            label="Подстатья"
            :error="errors.subArticle"
          >
            <select
              :id="attrs.id"
              :aria-describedby="attrs['aria-describedby']"
              :aria-invalid="attrs['aria-invalid'] === 'true' || undefined"
              :class="SELECT"
              :value="form.subArticle"
              :disabled="busy"
              @change="set('subArticle', ($event.target as HTMLSelectElement).value)"
            >
              <option value="">Не указана</option>
              <option v-for="o in options.subArticles" :key="o.key" :value="o.key">
                {{ o.label }}
              </option>
            </select>
          </FormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <FormField
            id="manual-amount"
            v-slot="{ attrs }"
            label="Сумма, ₽ (минус — удержание)"
            :error="errors.amount"
          >
            <Input
              v-bind="attrs"
              :model-value="form.amount"
              inputmode="decimal"
              placeholder="-1500 или 300,50"
              :disabled="busy"
              @update:model-value="set('amount', String($event))"
            />
          </FormField>
          <FormField id="manual-day" v-slot="{ attrs }" label="Дата" :error="errors.accruedOn">
            <Input
              v-bind="attrs"
              type="date"
              :model-value="form.accruedOn"
              :disabled="busy"
              @update:model-value="set('accruedOn', String($event))"
            />
          </FormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <FormField id="manual-order" v-slot="{ attrs }" label="Заказ" :error="errors.orderId">
            <Input
              v-bind="attrs"
              :model-value="form.orderId"
              :maxlength="limits.ref"
              placeholder="Необязательно"
              :disabled="busy"
              @update:model-value="set('orderId', String($event))"
            />
          </FormField>
          <FormField id="manual-sku" v-slot="{ attrs }" label="SKU" :error="errors.sku">
            <Input
              v-bind="attrs"
              :model-value="form.sku"
              :maxlength="limits.ref"
              placeholder="Необязательно"
              :disabled="busy"
              @update:model-value="set('sku', String($event))"
            />
          </FormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <FormField id="manual-source" v-slot="{ attrs }" label="Источник" :error="errors.source">
            <Input
              v-bind="attrs"
              :model-value="form.source"
              :maxlength="limits.source"
              placeholder="Письмо поддержки, акт сверки…"
              :disabled="busy"
              @update:model-value="set('source', String($event))"
            />
          </FormField>
          <FormField
            id="manual-document"
            v-slot="{ attrs }"
            label="Номер документа"
            :error="errors.documentNumber"
          >
            <Input
              v-bind="attrs"
              :model-value="form.documentNumber"
              :maxlength="limits.documentNumber"
              placeholder="Необязательно"
              :disabled="busy"
              @update:model-value="set('documentNumber', String($event))"
            />
          </FormField>
        </div>

        <FormField id="manual-note" v-slot="{ attrs }" label="Комментарий" :error="errors.note">
          <Input
            v-bind="attrs"
            :model-value="form.note"
            :maxlength="limits.note"
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
