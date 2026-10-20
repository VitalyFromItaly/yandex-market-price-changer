<script setup lang="ts">
/** Абзац справки: сплошной текст, строки по одной или список. */
import type { HelpBlock } from '../help.domain';

import HelpSpans from './HelpSpans.vue';

defineProps<{ block: HelpBlock }>();
</script>

<template>
  <p v-if="block.kind === 'text'" class="text-sm leading-relaxed">
    <HelpSpans :spans="block.spans" />
  </p>
  <div v-else-if="block.kind === 'lines'" class="flex flex-col gap-1 text-sm">
    <div v-for="(item, index) in block.items" :key="index"><HelpSpans :spans="item" /></div>
  </div>
  <ol v-else-if="block.ordered" class="flex list-decimal flex-col gap-1 pl-5 text-sm">
    <li v-for="(item, index) in block.items" :key="index"><HelpSpans :spans="item" /></li>
  </ol>
  <ul v-else class="flex list-disc flex-col gap-1 pl-5 text-sm">
    <li v-for="(item, index) in block.items" :key="index"><HelpSpans :spans="item" /></li>
  </ul>
</template>
