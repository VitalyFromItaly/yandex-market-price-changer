<script setup lang="ts">
/**
 * Форма продвижения одного бренда: режим, проценты и нижний порог. Поля — по
 * режиму; значения проверяет сервер тем же правилом, что шаги бота, и ошибка
 * встаёт под своё поле.
 */
import type { PromoForm, PromoMode, SettingsErrors } from '../settings.domain';

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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

defineProps<{ title: string; errors: SettingsErrors; busy: boolean }>();
const open = defineModel<boolean>('open', { default: false });
const form = defineModel<PromoForm>('form', { required: true });
const emit = defineEmits<{ save: [] }>();

/** Поле меняется заменой объекта, а не мутацией чужого состояния. */
function set<K extends keyof PromoForm>(key: K, value: PromoForm[K]): void {
  form.value = { ...form.value, [key]: value };
}

function setMode(value: string | number): void {
  set('mode', value === 'tiered' ? 'tiered' : ('flat' satisfies PromoMode));
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>Процент от цены продажи товара бренда.</DialogDescription>
      </DialogHeader>

      <Form @submit="emit('save')">
        <Tabs :model-value="form.mode" @update:model-value="setMode">
          <TabsList>
            <TabsTrigger value="flat">Общий процент</TabsTrigger>
            <TabsTrigger value="tiered">Зависит от цены</TabsTrigger>
          </TabsList>
        </Tabs>

        <FormField
          v-if="form.mode === 'flat'"
          id="promo-percent"
          v-slot="{ attrs }"
          label="Процент, %"
          :error="errors.percent"
        >
          <Input
            v-bind="attrs"
            :model-value="form.percent"
            inputmode="decimal"
            placeholder="2"
            :disabled="busy"
            @update:model-value="set('percent', String($event))"
          />
        </FormField>

        <template v-else>
          <FormField
            id="promo-limit"
            v-slot="{ attrs }"
            label="Граница цены, ₽"
            :error="errors.limit"
          >
            <Input
              v-bind="attrs"
              :model-value="form.limit"
              inputmode="decimal"
              placeholder="10000"
              :disabled="busy"
              @update:model-value="set('limit', String($event))"
            />
          </FormField>
          <div class="grid gap-4 sm:grid-cols-2">
            <FormField
              id="promo-below"
              v-slot="{ attrs }"
              label="До границы включительно, %"
              :error="errors.below"
            >
              <Input
                v-bind="attrs"
                :model-value="form.below"
                inputmode="decimal"
                placeholder="2"
                :disabled="busy"
                @update:model-value="set('below', String($event))"
              />
            </FormField>
            <FormField
              id="promo-above"
              v-slot="{ attrs }"
              label="Дороже границы, %"
              :error="errors.above"
            >
              <Input
                v-bind="attrs"
                :model-value="form.above"
                inputmode="decimal"
                placeholder="1"
                :disabled="busy"
                @update:model-value="set('above', String($event))"
              />
            </FormField>
          </div>
        </template>

        <FormField
          id="promo-from"
          v-slot="{ attrs }"
          label="Не начислять дешевле, ₽"
          :error="errors.from"
        >
          <Input
            v-bind="attrs"
            :model-value="form.from"
            inputmode="decimal"
            placeholder="Пусто — с любой цены"
            :disabled="busy"
            @update:model-value="set('from', String($event))"
          />
        </FormField>

        <Alert v-if="errors.form || errors.mode || errors.brand">
          {{ errors.form ?? errors.mode ?? errors.brand }}
        </Alert>

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
