<script setup lang="ts">
import { ShoppingBag } from 'lucide-vue-next';

/** Знак CRM — красно-оранжевая плашка бренда. Иконка из бандла: внешних ассетов нет. */
</script>

<template>
  <span
    class="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-brand text-brand-foreground"
    aria-hidden="true"
  >
    <ShoppingBag class="size-4" :stroke-width="2.25" />
  </span>
</template>
