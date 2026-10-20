<script setup lang="ts">
/**
 * Правка закупа: цена поставщика, валюта с курсом и доп. расходы на штуку.
 * Ложится в историю с сегодняшнего дня; следующий прайс с новой ценой сменит
 * цену и валюту на рубли, доп. расходы останутся.
 */
import type { PurchaseErrors, PurchaseForm } from '../products.domain';

import { computed } from 'vue';

import { BASE_CURRENCY, CURRENCY_LABEL } from '../constants/purchase.products';

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

const props = defineProps<{ currencies: string[]; errors: PurchaseErrors; busy: boolean }>();
const open = defineModel<boolean>('open', { default: false });
const form = defineModel<PurchaseForm>('form', { required: true });
const emit = defineEmits<{ save: [] }>();

const currencyOptions = computed(() =>
  props.currencies.map((code) => ({
    value: code,
    label: `${code} ${CURRENCY_LABEL[code] ?? ''}`.trim(),
  })),
);
const foreign = computed(() => form.value.currency !== BASE_CURRENCY);

/** Поле меняется заменой объекта, а не мутацией чужого состояния. */
function set<K extends keyof PurchaseForm>(key: K, value: PurchaseForm[K]): void {
  form.value = { ...form.value, [key]: value };
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Изменить закуп</DialogTitle>
        <DialogDescription>
          Действует с сегодняшнего дня: прошлые продажи считаются по прежнему закупу.
        </DialogDescription>
      </DialogHeader>

      <Form @submit="emit('save')">
        <div class="flex flex-col gap-2">
          <span class="text-sm font-medium">Валюта</span>
          <OptionGroup
            label="Валюта"
            :model-value="form.currency"
            :options="currencyOptions"
            :disabled="busy"
            @update:model-value="set('currency', $event)"
          />
          <p v-if="errors.currency" class="text-sm text-destructive">{{ errors.currency }}</p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <FormField
            id="product-price"
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
            id="product-rate"
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
          id="product-extra"
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
        <p class="-mt-2 text-xs text-muted-foreground">
          Доставка от поставщика, упаковка. Скидка бренда на них не действует.
        </p>

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
