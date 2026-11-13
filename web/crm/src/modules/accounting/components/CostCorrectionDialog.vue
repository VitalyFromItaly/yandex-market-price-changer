<script setup lang="ts">
/**
 * Исправление прошлой цены закупа (TASK-235): момент начала действия, закуп с
 * валютой и курсом, доп. расходы и причина. Причина обязательна — без неё правку
 * задним числом не отличить от ошибки. Будущую цену задаёт прайс, не эта форма.
 */
import type { CostCorrectionErrors, CostCorrectionForm } from '../accounting.domain';

import { computed } from 'vue';

import { COST_REASON_MAX_LENGTH } from '../accounting.domain';

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
import { Textarea } from '@/components/ui/textarea';
import { BASE_CURRENCY, CURRENCY_LABEL } from '@/modules/products/constants/purchase.products';

const props = defineProps<{
  productLabel: string;
  currencies: string[];
  errors: CostCorrectionErrors;
  busy: boolean;
}>();
const open = defineModel<boolean>('open', { default: false });
const form = defineModel<CostCorrectionForm>('form', { required: true });
const emit = defineEmits<{ save: [] }>();

/** Поле меняется заменой объекта, а не мутацией чужого состояния. */
function set<K extends keyof CostCorrectionForm>(key: K, value: CostCorrectionForm[K]): void {
  form.value = { ...form.value, [key]: value };
}

const currencyOptions = computed(() =>
  (props.currencies.length ? props.currencies : [BASE_CURRENCY]).map((code) => ({
    value: code,
    label: `${code} ${CURRENCY_LABEL[code] ?? ''}`.trim(),
  })),
);
const foreign = computed(() => form.value.currency !== BASE_CURRENCY);
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Исправить прошлую цену</DialogTitle>
        <DialogDescription>
          {{ productLabel }}. Цена действует с указанного момента до следующей записи. Видно только
          «Финучёту» — «Товары» и «Финансы» считают как прежде.
        </DialogDescription>
      </DialogHeader>

      <Form @submit="emit('save')">
        <FormField
          id="cost-valid-from"
          v-slot="{ attrs }"
          label="Действует с (время московское)"
          :error="errors.validFrom"
        >
          <Input
            v-bind="attrs"
            type="datetime-local"
            :model-value="form.validFrom"
            :disabled="busy"
            @update:model-value="set('validFrom', String($event))"
          />
        </FormField>

        <div class="flex flex-col gap-2">
          <span class="text-sm font-medium">Валюта</span>
          <OptionGroup
            label="Валюта"
            :model-value="form.currency"
            :options="currencyOptions"
            :disabled="busy"
            @update:model-value="set('currency', String($event))"
          />
          <p v-if="errors.currency" class="text-sm text-destructive">{{ errors.currency }}</p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <FormField
            id="cost-price"
            v-slot="{ attrs }"
            label="Цена поставщика"
            :error="errors.price"
          >
            <Input
              v-bind="attrs"
              :model-value="form.price"
              inputmode="decimal"
              placeholder="1000"
              :disabled="busy"
              @update:model-value="set('price', String($event))"
            />
          </FormField>
          <FormField
            v-if="foreign"
            id="cost-rate"
            v-slot="{ attrs }"
            label="Курс, ₽ за единицу"
            :error="errors.rate"
          >
            <Input
              v-bind="attrs"
              :model-value="form.rate"
              inputmode="decimal"
              placeholder="90"
              :disabled="busy"
              @update:model-value="set('rate', String($event))"
            />
          </FormField>
        </div>

        <FormField
          id="cost-extra"
          v-slot="{ attrs }"
          label="Доп. расходы на штуку, ₽"
          :error="errors.extraCosts"
        >
          <Input
            v-bind="attrs"
            :model-value="form.extraCosts"
            inputmode="decimal"
            placeholder="Необязательно"
            :disabled="busy"
            @update:model-value="set('extraCosts', String($event))"
          />
        </FormField>

        <FormField id="cost-reason" v-slot="{ attrs }" label="Причина" :error="errors.reason">
          <Textarea
            v-bind="attrs"
            class="min-h-20"
            :model-value="form.reason"
            :maxlength="COST_REASON_MAX_LENGTH"
            placeholder="Например: поставщик прислал счёт с другой ценой"
            :disabled="busy"
            @update:model-value="set('reason', String($event ?? ''))"
          />
        </FormField>

        <Alert v-if="errors.form">{{ errors.form }}</Alert>

        <DialogFooter>
          <Button type="button" variant="outline" :disabled="busy" @click="open = false">
            Отмена
          </Button>
          <Button type="submit" :disabled="busy">{{ busy ? 'Сохраняем…' : 'Исправить' }}</Button>
        </DialogFooter>
      </Form>
    </DialogContent>
  </Dialog>
</template>
