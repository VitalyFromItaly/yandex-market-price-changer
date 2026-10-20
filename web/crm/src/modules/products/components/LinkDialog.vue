<script setup lang="ts">
/**
 * Ручная привязка карточки площадки к товару: кандидаты сервера или любой
 * товар через поиск. Привязка уводит карточку с другого товара, если она там
 * была, — так решает сервер, тем же правилом, что у админки.
 */
import type { ProductListItem, UnmatchedCandidate, UnmatchedCard } from '../products.domain';

import { computed } from 'vue';

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
import { Input } from '@/components/ui/input';

const props = defineProps<{
  target: UnmatchedCard | null;
  candidates: UnmatchedCandidate[];
  found: ProductListItem[];
  searching: boolean;
  error: string | null;
  busy: boolean;
}>();
const open = defineModel<boolean>('open', { default: false });
const selected = defineModel<string | null>('selected', { default: null });
const query = defineModel<string>('query', { default: '' });
const emit = defineEmits<{ confirm: [] }>();

/** Кандидаты и найденные — один список выбора, без повторов. */
const options = computed(() => {
  const seen = new Set<string>();
  const rows: { id: string; sku: string; name: string; candidate: boolean }[] = [];
  for (const c of props.candidates) {
    seen.add(c.productId);
    rows.push({ id: c.productId, sku: c.internalSku ?? '—', name: c.name ?? '', candidate: true });
  }
  for (const p of props.found) {
    if (seen.has(p.id)) continue;
    rows.push({ id: p.id, sku: p.internalSku, name: p.name ?? '', candidate: false });
  }
  return rows;
});
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Привязать карточку {{ target?.sku }}</DialogTitle>
        <DialogDescription>
          {{ target?.name ?? 'Выберите товар, которому принадлежит карточка.' }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-3">
        <Input
          v-model="query"
          type="search"
          placeholder="Найти товар по артикулу или названию"
          aria-label="Поиск товара"
          :disabled="busy"
        />
        <p v-if="searching" class="text-sm text-muted-foreground">Ищем…</p>
        <p v-else-if="options.length === 0" class="text-sm text-muted-foreground">
          Кандидатов нет — найдите товар поиском.
        </p>
        <ul v-else class="flex max-h-72 flex-col gap-1 overflow-y-auto" role="radiogroup">
          <li v-for="row in options" :key="row.id">
            <label
              class="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-muted"
            >
              <input
                v-model="selected"
                type="radio"
                name="link-product"
                :value="row.id"
                class="mt-1"
                :disabled="busy"
              />
              <span class="flex flex-col">
                <span class="font-mono text-sm">{{ row.sku }}</span>
                <span class="text-sm text-muted-foreground">
                  {{ row.name || '—' }}<template v-if="row.candidate"> · кандидат</template>
                </span>
              </span>
            </label>
          </li>
        </ul>
        <Alert v-if="error">{{ error }}</Alert>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" :disabled="busy" @click="open = false">
          Отмена
        </Button>
        <Button :disabled="busy || selected === null" @click="emit('confirm')">
          {{ busy ? 'Привязываем…' : 'Привязать' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
