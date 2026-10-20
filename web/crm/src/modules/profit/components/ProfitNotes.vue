<script setup lang="ts">
/**
 * Строки под сводкой — в словах бота: отменённые, выкуплено, возвраты,
 * сравнение со ставкой; ниже тихо — из чего получен закуп и оговорки.
 */
import { Info } from 'lucide-vue-next';

defineProps<{ lines: readonly string[]; footer: readonly string[] }>();
</script>

<template>
  <div class="flex flex-col gap-4 text-sm">
    <div v-if="lines.length" class="tnum flex flex-col gap-1.5">
      <p v-for="line in lines" :key="line">{{ line }}</p>
    </div>
    <div class="flex flex-col gap-1.5 text-muted-foreground">
      <p v-for="line in footer" :key="line" class="flex items-start gap-1.5">
        <Info class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {{ line }}
      </p>
    </div>
  </div>
</template>
