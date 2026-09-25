<script setup lang="ts">
/**
 * Строка справки из кусков. Переносы `\n` внутри текста — ручные переносы бота
 * под ширину Telegram; обычный white-space сворачивает их в пробел.
 */
import type { HelpSpan } from '../help.domain';

defineProps<{ spans: HelpSpan[] }>();
</script>

<template>
  <template v-for="(span, index) in spans" :key="index">
    <strong v-if="span.kind === 'bold'" class="font-semibold">{{ span.text }}</strong>
    <code
      v-else-if="span.kind === 'code'"
      class="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
      >{{ span.text }}</code
    >
    <template v-else>{{ span.text }}</template>
  </template>
</template>
