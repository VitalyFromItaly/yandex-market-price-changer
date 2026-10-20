<script setup lang="ts">
import type { HTMLAttributes } from 'vue';

import { cn } from '@/lib/utils';

const props = defineProps<{ class?: HTMLAttributes['class'] }>();
</script>

<template>
  <!-- Горизонтальная прокрутка — у таблицы, а не у страницы: на телефоне колонки не влезут. -->
  <div class="relative w-full overflow-x-auto">
    <table :class="cn('w-full caption-bottom text-sm', props.class)">
      <slot />
    </table>
  </div>
</template>
