<script setup lang="ts">
/**
 * Как задать цены: наценкой от закупа (строка на площадку — галочка и процент)
 * или файлом «артикул | цена» с выбором площадок. Кнопка «Посчитать план» —
 * здесь: это ввод, запись — кнопкой в шапке страницы.
 */
import type { MarkupRow, PriceSetMarketplace, PriceSetMode } from '../price-set.domain';

import { Calculator } from 'lucide-vue-next';

import { markupExample, parseMarkupText } from '../mappers/mapPriceSet.price-set';
import { MARKETPLACE_LABEL, PRICE_FILE_ACCEPT, PRICE_SET_MODE_OPTIONS } from '../price-set.domain';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { FileInput } from '@/components/ui/file-input';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { OptionGroup } from '@/components/ui/option-group';

defineProps<{
  mode: PriceSetMode;
  markupOpen: boolean;
  rows: MarkupRow[];
  rowErrors: Partial<Record<PriceSetMarketplace, string | null>>;
  /** «24-09-2026» — дата последнего прайса с закупом; `null` — ещё не знаем или не было. */
  priceListDay: string | null;
  marketplaces: PriceSetMarketplace[];
  fileMarketplaces: PriceSetMarketplace[];
  file: File | null;
  fileError: string | null;
  disabled: boolean;
  canSubmit: boolean;
}>();
const emit = defineEmits<{
  'update:mode': [mode: PriceSetMode];
  'update:row': [marketplace: PriceSetMarketplace, patch: Partial<Pick<MarkupRow, 'on' | 'text'>>];
  'update:file': [file: File | null];
  toggleFileMarketplace: [marketplace: PriceSetMarketplace, on: boolean];
  submit: [];
}>();
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Как задать цены</CardTitle>
      <CardDescription>
        Сначала посчитаю план «было → станет» — в кабинеты ничего не уйдёт, пока вы не подтвердите
        запись.
      </CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-4">
      <OptionGroup
        v-if="markupOpen"
        :model-value="mode"
        :options="PRICE_SET_MODE_OPTIONS"
        label="Способ"
        :disabled="disabled"
        @update:model-value="emit('update:mode', $event)"
      />
      <p v-else class="text-sm text-muted-foreground">
        Наценка от закупа доступна при открытых закупочных ценах из прайса — их открывает
        администратор. Сейчас цены задаются файлом.
      </p>

      <template v-if="mode === 'markup'">
        <div class="flex flex-col gap-3">
          <div
            v-for="row in rows"
            :key="row.marketplace"
            class="grid items-start gap-x-4 gap-y-1 sm:grid-cols-[12rem_10rem_minmax(0,1fr)]"
          >
            <Checkbox
              class="h-9"
              :model-value="row.on"
              :label="row.label"
              :disabled="disabled"
              @update:model-value="emit('update:row', row.marketplace, { on: $event })"
            />
            <div class="flex flex-col gap-1">
              <Input
                :model-value="row.text"
                inputmode="decimal"
                placeholder="250"
                class="tabular-nums"
                :aria-label="`${row.label}: наценка, % от закупа`"
                :aria-invalid="rowErrors[row.marketplace] ? 'true' : undefined"
                :disabled="disabled || !row.on"
                @update:model-value="emit('update:row', row.marketplace, { text: String($event) })"
              />
              <span v-if="rowErrors[row.marketplace]" class="text-xs text-danger">
                {{ rowErrors[row.marketplace] }}
              </span>
            </div>
            <span class="text-sm text-muted-foreground tabular-nums sm:leading-9">
              % от закупа · {{ markupExample(parseMarkupText(row.text)) }}
            </span>
          </div>
        </div>
        <p class="text-sm text-muted-foreground">
          <template v-if="priceListDay">
            Закуп — из последнего прайса:
            <span class="font-medium text-foreground tabular-nums">{{ priceListDay }}</span
            >.
          </template>
          <template v-else>Закуп — из последнего загруженного прайса, как есть.</template>
        </p>
      </template>

      <template v-else>
        <FormField id="price-set-file" label="Файл с ценами" :error="fileError">
          <template #default="{ attrs }">
            <FileInput
              v-bind="attrs"
              :model-value="file"
              :accept="PRICE_FILE_ACCEPT"
              :disabled="disabled"
              hint="Две колонки: артикул и цена в рублях. Excel (.xlsx, .xls) или .csv, до 10 МБ"
              @update:model-value="emit('update:file', $event)"
            />
          </template>
        </FormField>
        <div class="flex flex-col gap-2" role="group" aria-label="Площадки для цен из файла">
          <span class="text-sm font-medium">Площадки</span>
          <div class="flex flex-wrap gap-x-6 gap-y-2">
            <Checkbox
              v-for="mp in marketplaces"
              :key="mp"
              :model-value="fileMarketplaces.includes(mp)"
              :label="MARKETPLACE_LABEL[mp]"
              :disabled="disabled"
              @update:model-value="emit('toggleFileMarketplace', mp, $event)"
            />
          </div>
        </div>
      </template>

      <div>
        <Button :disabled="disabled || !canSubmit" @click="emit('submit')">
          <Calculator />
          Посчитать план
        </Button>
      </div>
    </CardContent>
  </Card>
</template>
