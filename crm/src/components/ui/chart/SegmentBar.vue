<script setup lang="ts" generic="K extends string">
/**
 * Доли целого одной полосой + легенда с числами. Легенда обязательна: цвет
 * без подписи никому ничего не говорит, и она же — доступный текст.
 *
 * Интерактивность — по желанию: с `selectable` сегмент и пункт легенды —
 * кнопки, клик выбирает (повторный — снимает), экран фильтрует по нему
 * таблицу. Выбранный сегмент ярче, остальные приглушаются.
 */
import type { Segment } from './chart.domain';

import { computed } from 'vue';

import { TONE_BG, formatShare, placeSegments } from './chart.domain';

import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatCount } from '@/shared/utils';

const props = withDefaults(
  defineProps<{
    segments: readonly Segment<K>[];
    /** Доступное имя: что делится на части. */
    label: string;
    selectable?: boolean;
    selected?: K | null;
    /** Формат числа в легенде; по умолчанию — штуки. */
    format?: (value: number) => string;
  }>(),
  { selectable: false, selected: null, format: formatCount },
);
const emit = defineEmits<{ select: [K | null] }>();

const placed = computed(() => placeSegments(props.segments));
const total = computed(() => placed.value.reduce((sum, s) => sum + s.value, 0));

const dimmed = (key: K): boolean => props.selected !== null && props.selected !== key;
const toggle = (key: K): void => {
  if (props.selectable) emit('select', props.selected === key ? null : key);
};
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <div
      class="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full"
      role="img"
      :aria-label="label"
    >
      <Tooltip
        v-for="segment in placed"
        :key="segment.key"
        :text="`${segment.label}: ${format(segment.value)} · ${formatShare(segment.value, total)}`"
      >
        <component
          :is="selectable ? 'button' : 'div'"
          :type="selectable ? 'button' : undefined"
          tabindex="-1"
          :class="
            cn(
              'h-full min-w-1 transition-opacity first:rounded-l-full last:rounded-r-full',
              TONE_BG[segment.tone],
              dimmed(segment.key) && 'opacity-30',
              selectable && 'cursor-pointer hover:opacity-80',
            )
          "
          :style="{ flexGrow: segment.share, flexBasis: 0 }"
          @click="toggle(segment.key)"
        />
      </Tooltip>
    </div>
    <ul class="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
      <li v-for="segment in placed" :key="segment.key">
        <component
          :is="selectable ? 'button' : 'span'"
          :type="selectable ? 'button' : undefined"
          :aria-pressed="selectable ? selected === segment.key : undefined"
          :class="
            cn(
              'inline-flex items-center gap-1.5 rounded-md transition-opacity',
              selectable &&
                'px-1 -mx-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              dimmed(segment.key) && 'opacity-50',
            )
          "
          @click="toggle(segment.key)"
        >
          <span
            :class="cn('size-2.5 shrink-0 rounded-sm', TONE_BG[segment.tone])"
            aria-hidden="true"
          />
          <span class="text-muted-foreground">{{ segment.label }}</span>
          <span class="tnum font-medium">{{ format(segment.value) }}</span>
          <span class="tnum text-xs text-muted-foreground">{{
            formatShare(segment.value, total)
          }}</span>
        </component>
      </li>
    </ul>
  </div>
</template>
