<script setup lang="ts">
/**
 * Пояснение по запросу — вместо постоянной строки прозы под контролом.
 * Использование: <Tooltip text="…"><Button …/></Tooltip>. TooltipProvider — в App.vue.
 */
import { TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from 'reka-ui';

defineProps<{ text: string; side?: 'top' | 'right' | 'bottom' | 'left' }>();
</script>

<template>
  <TooltipRoot>
    <TooltipTrigger as-child>
      <slot />
    </TooltipTrigger>
    <TooltipPortal>
      <TooltipContent
        :side="side ?? 'top'"
        :side-offset="4"
        class="z-50 max-w-xs rounded-md bg-foreground px-3 py-1.5 text-xs text-background shadow-md"
      >
        {{ text }}
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>
