<script setup lang="ts">
import type { ThemePreference } from '@/shared/composables';

import { Monitor, Moon, Sun } from 'lucide-vue-next';

import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useTheme } from '@/shared/composables';

/**
 * Три режима темы иконками — сегментом, а не выпадающим списком: вариантов три,
 * и все помещаются. Подпись режима — в тултипе и `aria-label`.
 */
const { preference, setPreference } = useTheme();

const OPTIONS: readonly { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'Как в системе', icon: Monitor },
  { value: 'light', label: 'Светлая тема', icon: Sun },
  { value: 'dark', label: 'Тёмная тема', icon: Moon },
];
</script>

<template>
  <div
    class="inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5"
    role="group"
    aria-label="Тема"
  >
    <Tooltip v-for="option in OPTIONS" :key="option.value" :text="option.label">
      <button
        type="button"
        :aria-label="option.label"
        :aria-pressed="option.value === preference"
        :class="
          cn(
            'inline-flex size-7 items-center justify-center rounded-sm transition-colors [&_svg]:size-3.5',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            option.value === preference
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )
        "
        @click="setPreference(option.value)"
      >
        <component :is="option.icon" aria-hidden="true" />
      </button>
    </Tooltip>
  </div>
</template>
