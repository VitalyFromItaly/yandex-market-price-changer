<script setup lang="ts">
/**
 * Выбор файла: настоящий `<input type="file">` (фокус, клавиатура, скринридер
 * — бесплатно) внутри зоны, куда файл можно и перетащить. Выбранный файл
 * показывается именем и размером; `accept` — подсказка диалогу, проверяет
 * размер и формат всё равно вызывающий и сервер.
 */
import type { HTMLAttributes } from 'vue';

import { FileSpreadsheet, Upload } from 'lucide-vue-next';
import { ref } from 'vue';

import { cn } from '@/lib/utils';

// Атрибуты поля (id, aria-*) — на сам <input>, а не на обёртку-label.
defineOptions({ inheritAttrs: false });

const props = defineProps<{
  accept?: string;
  disabled?: boolean;
  /** Подсказка под пустой зоной: форматы и лимит. */
  hint?: string;
  class?: HTMLAttributes['class'];
}>();

const model = defineModel<File | null>({ default: null });
const dragging = ref(false);
const input = ref<HTMLInputElement | null>(null);

function pick(files: FileList | null | undefined): void {
  const file = files?.item(0) ?? null;
  if (file !== null) model.value = file;
}

function onChange(event: Event): void {
  pick((event.target as HTMLInputElement).files);
  // Повторный выбор того же файла тоже должен сработать.
  if (input.value !== null) input.value.value = '';
}

function onDrop(event: DragEvent): void {
  dragging.value = false;
  if (!props.disabled) pick(event.dataTransfer?.files);
}

function sizeOf(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`;
}
</script>

<template>
  <label
    :class="
      cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed ' +
          'border-input px-6 py-8 text-center text-sm transition-colors hover:bg-accent/50 ' +
          'focus-within:ring-2 focus-within:ring-ring has-[[aria-invalid=true]]:border-danger',
        dragging && 'border-primary bg-accent/50',
        disabled && 'pointer-events-none opacity-50',
        props.class,
      )
    "
    @dragover.prevent="dragging = true"
    @dragleave="dragging = false"
    @drop.prevent="onDrop"
  >
    <input
      ref="input"
      v-bind="$attrs"
      type="file"
      class="sr-only"
      :accept="accept"
      :disabled="disabled"
      @change="onChange"
    />
    <template v-if="model">
      <FileSpreadsheet class="size-6 text-muted-foreground" aria-hidden="true" />
      <span class="max-w-full truncate font-medium">{{ model.name }}</span>
      <span class="tnum text-muted-foreground">{{ sizeOf(model.size) }} · выбрать другой</span>
    </template>
    <template v-else>
      <Upload class="size-6 text-muted-foreground" aria-hidden="true" />
      <span class="font-medium">Выберите файл или перетащите его сюда</span>
      <span v-if="hint" class="text-muted-foreground">{{ hint }}</span>
    </template>
  </label>
</template>
