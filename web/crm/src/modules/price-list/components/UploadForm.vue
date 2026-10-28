<script setup lang="ts">
/**
 * Файл и режим. Кнопка «Загрузить» — в шапке страницы (основное действие),
 * здесь только ввод.
 */
import { Info } from 'lucide-vue-next';

import { UPLOAD_ACCEPT } from '../price-list.domain';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { FileInput } from '@/components/ui/file-input';
import { FormField } from '@/components/ui/form-field';
import { Tooltip } from '@/components/ui/tooltip';

// Файл — управляемый: выбор снимает ошибку под полем (эффект), поэтому не v-model.
defineProps<{
  file: File | null;
  fileError: string | null;
  disabled: boolean;
  /** Файл сам пишет остатки в Маркет — тогда есть «Только проверка». */
  stockUpdateOpen: boolean;
  /** Остатки пишет план по площадкам ниже, файл — только свой склад и закуп. */
  stocksByPlan: boolean;
}>();
const emit = defineEmits<{ 'update:file': [file: File | null] }>();
const dryRun = defineModel<boolean>('dryRun', { default: false });
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Прайс поставщика</CardTitle>
      <CardDescription>
        <template v-if="stocksByPlan">
          Из файла сохранятся свой склад и закупочные цены. Остатки запишутся на отмеченные площадки
          — по плану ниже, отдельной кнопкой.
        </template>
        <template v-else-if="stockUpdateOpen">
          Из файла обновятся остатки на Маркете и сохранятся закупочные цены.
        </template>
        <template v-else
          >Из файла сохранятся закупочные цены — по ним считается «Прибыль».</template
        >
      </CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-4">
      <FormField id="price-list-file" label="Файл" :error="fileError">
        <template #default="{ attrs }">
          <FileInput
            v-bind="attrs"
            :model-value="file"
            :accept="UPLOAD_ACCEPT"
            :disabled="disabled"
            hint="Excel (.xlsx или .xls), до 10 МБ"
            @update:model-value="emit('update:file', $event)"
          />
        </template>
      </FormField>
      <div v-if="stockUpdateOpen" class="flex items-center gap-1.5">
        <Checkbox v-model="dryRun" label="Только проверка" :disabled="disabled" />
        <Tooltip
          text="Сверю файл с каталогом и сохраню закупочные цены, но остатки в Маркет не отправлю."
        >
          <button
            type="button"
            class="rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Что значит «Только проверка»"
          >
            <Info class="size-4" aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
    </CardContent>
  </Card>
</template>
