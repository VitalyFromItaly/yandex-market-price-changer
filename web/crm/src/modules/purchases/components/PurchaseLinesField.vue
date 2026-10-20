<script setup lang="ts">
/**
 * Позиции партии — необязательная справка: артикул, название, штуки, цена.
 * Под таблицей — Σ, пока продавец набирает; равенство с суммой проверит сервер.
 */
import type { PurchaseLineForm } from '../purchases.domain';

import { Plus, X } from 'lucide-vue-next';
import { computed } from 'vue';

import { emptyLine, linesTotalText } from '../mappers/mapPurchases.purchases';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const props = defineProps<{ max: number; busy: boolean; error?: string }>();
const lines = defineModel<PurchaseLineForm[]>({ required: true });

const total = computed(() => linesTotalText(lines.value));

function set(index: number, key: keyof PurchaseLineForm, value: string): void {
  lines.value = lines.value.map((line, i) => (i === index ? { ...line, [key]: value } : line));
}

function add(): void {
  if (lines.value.length < props.max) lines.value = [...lines.value, emptyLine()];
}

function remove(index: number): void {
  lines.value = lines.value.filter((_, i) => i !== index);
}
</script>

<template>
  <fieldset class="flex flex-col gap-2">
    <legend class="mb-1 text-sm font-medium">Позиции (необязательно)</legend>
    <div
      v-for="(line, index) in lines"
      :key="index"
      class="grid grid-cols-[1fr_4.5rem_6rem_auto] gap-2 sm:grid-cols-[1fr_1fr_4.5rem_6rem_auto]"
    >
      <Input
        :model-value="line.sku"
        :aria-label="`Артикул, позиция ${index + 1}`"
        placeholder="Артикул"
        :disabled="busy"
        @update:model-value="set(index, 'sku', String($event))"
      />
      <Input
        class="hidden sm:block"
        :model-value="line.name"
        :aria-label="`Название, позиция ${index + 1}`"
        placeholder="Название"
        :disabled="busy"
        @update:model-value="set(index, 'name', String($event))"
      />
      <Input
        :model-value="line.count"
        :aria-label="`Штук, позиция ${index + 1}`"
        inputmode="numeric"
        placeholder="шт."
        :disabled="busy"
        @update:model-value="set(index, 'count', String($event))"
      />
      <Input
        :model-value="line.price"
        :aria-label="`Цена за штуку, позиция ${index + 1}`"
        inputmode="decimal"
        placeholder="Цена, ₽"
        :disabled="busy"
        @update:model-value="set(index, 'price', String($event))"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        :aria-label="`Убрать позицию ${index + 1}`"
        :disabled="busy"
        @click="remove(index)"
      >
        <X />
      </Button>
    </div>
    <div class="flex items-center justify-between gap-4">
      <Button
        type="button"
        variant="outline"
        size="sm"
        :disabled="busy || lines.length >= max"
        @click="add"
      >
        <Plus />
        Позиция
      </Button>
      <span v-if="total" class="text-sm text-muted-foreground tabular-nums">
        Сумма позиций: {{ total }}
      </span>
    </div>
    <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
  </fieldset>
</template>
