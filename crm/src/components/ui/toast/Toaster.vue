<script setup lang="ts">
import { X } from 'lucide-vue-next';
import {
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastRoot,
  ToastTitle,
  ToastViewport,
} from 'reka-ui';

import { useToasts } from './toast';

import { cn } from '@/lib/utils';

const { items, dismiss } = useToasts();

const accent: Record<string, string> = {
  success: 'border-l-ok',
  error: 'border-l-danger',
  info: 'border-l-primary',
};
</script>

<template>
  <ToastProvider :duration="5000" swipe-direction="right" label="Уведомление">
    <ToastRoot
      v-for="item in items"
      :key="item.id"
      :duration="item.kind === 'error' ? 8000 : 5000"
      :class="
        cn(
          'relative grid gap-1 rounded-md border border-l-4 bg-popover p-4 pr-9 text-popover-foreground shadow-md',
          accent[item.kind],
        )
      "
      @update:open="(open: boolean) => !open && dismiss(item.id)"
    >
      <ToastTitle class="text-sm font-medium">{{ item.title }}</ToastTitle>
      <ToastDescription v-if="item.description" class="text-sm text-muted-foreground">
        {{ item.description }}
      </ToastDescription>
      <ToastClose
        class="absolute right-2 top-2 rounded-sm p-1 text-muted-foreground hover:text-foreground"
        aria-label="Закрыть"
      >
        <X class="size-4" />
      </ToastClose>
    </ToastRoot>
    <ToastViewport
      class="fixed bottom-0 right-0 z-[100] flex w-full max-w-sm flex-col gap-2 p-4 outline-none"
    />
  </ToastProvider>
</template>
