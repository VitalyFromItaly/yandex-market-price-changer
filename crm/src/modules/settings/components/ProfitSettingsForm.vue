<script setup lang="ts">
/**
 * Ставки и скидки по брендам — одна форма и одна кнопка «Сохранить»: продавец
 * правит несколько полей и сохраняет разом. Проверяет значения сервер тем же
 * правилом, что бот; ошибка встаёт под своё поле.
 */
import type { Settings } from '../settings.domain';

import { computed } from 'vue';

import { useProfitForm } from '../composables/useProfitForm.settings';
import { brandFieldKey } from '../settings.domain';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form } from '@/components/ui/form';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCount } from '@/shared/utils';

const props = defineProps<{ settings: Settings }>();

const { form, errors, busy, dirty, submit, discard } = useProfitForm();

/** Ошибки скидок — одной плашкой под таблицей: текст сервера сам называет бренд. */
const tableErrors = computed(() =>
  Object.entries(errors.value)
    .filter(([key]) => key === 'form' || key === 'discountPercent' || key.startsWith('brand:'))
    .map(([, message]) => message),
);

const noPriceList = computed(() => !props.settings.brands.length && !props.settings.otherCount);
</script>

<template>
  <Form v-if="form" class="gap-6" @submit="submit">
    <Card>
      <CardHeader>
        <CardTitle>Ставки</CardTitle>
        <CardDescription>Проценты от продаж, которые вычитаются в «Прибыли».</CardDescription>
      </CardHeader>
      <CardContent class="grid gap-4 sm:grid-cols-2">
        <FormField
          id="commission-percent"
          v-slot="{ attrs }"
          label="Комиссия Яндекс.Маркета, %"
          :error="errors.commissionPercent"
        >
          <Input
            v-bind="attrs"
            v-model="form.commissionPercent"
            inputmode="decimal"
            :disabled="busy"
          />
        </FormField>
        <FormField
          id="tax-percent"
          v-slot="{ attrs }"
          label="Налог с продаж, %"
          :error="errors.taxPercent"
        >
          <Input v-bind="attrs" v-model="form.taxPercent" inputmode="decimal" :disabled="busy" />
        </FormField>
      </CardContent>
    </Card>

    <Card class="p-0">
      <CardHeader>
        <CardTitle>Скидки от прайса</CardTitle>
        <CardDescription>
          Закуп = цена прайса минус скидка бренда. Бренды — из вашего прайса<template
            v-if="noPriceList"
            >; пришлите прайс, и они появятся здесь</template
          >.
        </CardDescription>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Бренд</TableHead>
            <TableHead class="text-right">Позиций</TableHead>
            <TableHead class="w-32 text-right">Скидка, %</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="brand in settings.brands" :key="brand.key">
            <TableCell>{{ brand.title }}</TableCell>
            <TableCell class="tnum text-right">{{ formatCount(brand.count) }}</TableCell>
            <TableCell>
              <Input
                v-model="form.brands[brand.key]"
                class="text-right"
                inputmode="decimal"
                :aria-label="`Скидка «${brand.title}», %`"
                :aria-invalid="errors[brandFieldKey(brand.key)] ? 'true' : undefined"
                :disabled="busy"
              />
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Остальные</TableCell>
            <TableCell class="tnum text-right">{{ formatCount(settings.otherCount) }}</TableCell>
            <TableCell>
              <Input
                v-model="form.discountPercent"
                class="text-right"
                inputmode="decimal"
                aria-label="Скидка для остальных брендов, %"
                :aria-invalid="errors.discountPercent ? 'true' : undefined"
                :disabled="busy"
              />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>

    <Alert v-for="message in tableErrors" :key="message">{{ message }}</Alert>

    <div class="flex flex-wrap gap-2">
      <Button type="submit" :disabled="busy || !dirty">
        {{ busy ? 'Сохраняем…' : 'Сохранить' }}
      </Button>
      <Button v-if="dirty" type="button" variant="outline" :disabled="busy" @click="discard">
        Отменить
      </Button>
    </div>
  </Form>
</template>
