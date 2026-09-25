<script setup lang="ts">
/**
 * Постраничный переход для длинных списков: «Назад / Вперёд» и где мы. Номер
 * страницы — с единицы; компонент управляемый (`page` + `@update:page`) —
 * смену страницы грузит стор.
 */
import { ChevronLeft, ChevronRight } from 'lucide-vue-next';

import { Button } from '@/components/ui/button';

const props = defineProps<{ page: number; pages: number; disabled?: boolean }>();
const emit = defineEmits<{ 'update:page': [page: number] }>();

function go(next: number): void {
  if (next >= 1 && next <= props.pages && next !== props.page) emit('update:page', next);
}
</script>

<template>
  <nav v-if="pages > 1" class="flex items-center justify-end gap-2" aria-label="Страницы">
    <Button
      variant="outline"
      size="sm"
      :disabled="disabled || page <= 1"
      aria-label="Предыдущая страница"
      @click="go(page - 1)"
    >
      <ChevronLeft />
      Назад
    </Button>
    <span class="tnum text-sm text-muted-foreground">{{ page }} из {{ pages }}</span>
    <Button
      variant="outline"
      size="sm"
      :disabled="disabled || page >= pages"
      aria-label="Следующая страница"
      @click="go(page + 1)"
    >
      Вперёд
      <ChevronRight />
    </Button>
  </nav>
</template>
