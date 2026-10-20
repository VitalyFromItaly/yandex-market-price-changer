<script setup lang="ts">
/**
 * Подтверждение «да/нет» — вместо window.confirm. Обязательно перед всем, что
 * меняет мир за пределами нашей базы: публичный ответ на отзыв, цена из
 * карантина, запись остатков.
 */
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

withDefaults(
  defineProps<{
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
    busy?: boolean;
  }>(),
  {
    description: undefined,
    confirmLabel: 'Подтвердить',
    cancelLabel: 'Отмена',
    destructive: false,
    busy: false,
  },
);

const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ confirm: [] }>();
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription v-if="description">{{ description }}</DialogDescription>
      </DialogHeader>
      <slot />
      <DialogFooter>
        <Button variant="outline" :disabled="busy" @click="open = false">{{ cancelLabel }}</Button>
        <Button
          :variant="destructive ? 'destructive' : 'default'"
          :disabled="busy"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
