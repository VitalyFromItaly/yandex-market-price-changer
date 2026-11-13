<script setup lang="ts">
/**
 * Форма закупки: поставщик, дата оплаты, сумма, комментарий и необязательные
 * позиции. Закупка — движение денег, на прибыль не влияет. При фиче «Финучёт:
 * партии» (TASK-214) — ещё доставка от поставщика и прочие расходы: они идут в
 * себестоимость партий, а не в сумму закупки и ДДС.
 */
import type { PurchaseErrors, PurchaseForm } from '../purchases.domain';

import { LOT_COST_SPLIT_OPTIONS } from '../purchases.domain';

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
import { OptionGroup } from '@/components/ui/option-group';

defineProps<{
  title: string;
  limits: { supplierMaxLength: number; noteMaxLength: number; linesMax: number };
  lotsEnabled: boolean;
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

        <template v-if="lotsEnabled">
          <div class="grid gap-4 sm:grid-cols-2">
            <FormField
              id="purchase-delivery"
              v-slot="{ attrs }"
              label="Доставка от поставщика, ₽"
              :error="errors.delivery"
            >
              <Input
                v-bind="attrs"
                :model-value="form.delivery"
                inputmode="decimal"
                placeholder="0"
                :disabled="busy"
                @update:model-value="set('delivery', String($event))"
              />
            </FormField>
            <FormField
              id="purchase-other-costs"
              v-slot="{ attrs }"
              label="Прочие расходы в себестоимость, ₽"
              :error="errors.otherCosts"
            >
              <Input
                v-bind="attrs"
                :model-value="form.otherCosts"
                inputmode="decimal"
                placeholder="0"
                :disabled="busy"
                @update:model-value="set('otherCosts', String($event))"
              />
            </FormField>
          </div>
          <div class="flex flex-col gap-2">
            <OptionGroup
              :model-value="form.lotCostSplit"
              :options="LOT_COST_SPLIT_OPTIONS"
              label="Как разнести по позициям"
              :disabled="busy"
              @update:model-value="set('lotCostSplit', $event)"
            />
            <p class="text-sm text-muted-foreground">
              Разносятся по позициям в себестоимость партий «Финучёта». В сумму закупки и движение
              денег не входят.
            </p>
            <p v-if="errors.lotCostSplit" class="text-sm text-danger" role="alert">
              {{ errors.lotCostSplit }}
            </p>
          </div>
        </template>

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
