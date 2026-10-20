<script setup lang="ts">
import { computed } from 'vue';

/**
 * Мини-график столбиками на inline SVG.
 *
 * Своё, а не библиотека: в панели графиков больше нет, а CDN недоступен с
 * прод-хоста в РФ — тянуть в бандл chart.js ради трёх полосок незачем.
 *
 * Столбец — `value` (нейтральный цвет) и опциональная «плохая» часть `bad`
 * поверх него снизу (красным). `null` — данных за столбец нет: рисуется
 * пунктирной чертой у оси, чтобы «не мерили» не читалось как «ноль».
 */
export interface IBar {
  at: number;
  value: number | null;
  bad?: number;
  title: string;
}

const props = defineProps<{ bars: IBar[]; height?: number }>();

const HEIGHT = computed(() => props.height ?? 48);
const GAP = 2;
const WIDTH = 600;

const max = computed(() => Math.max(1, ...props.bars.map((bar) => bar.value ?? 0)));
const barWidth = computed(() =>
  props.bars.length ? Math.max(1, WIDTH / props.bars.length - GAP) : 0,
);

function x(index: number): number {
  return index * (barWidth.value + GAP);
}

function h(value: number): number {
  if (value <= 0) return 0;
  // Минимум 1px: единичный вызов на фоне тысяч не должен исчезать совсем.
  return Math.max(1, (value / max.value) * HEIGHT.value);
}
</script>

<template>
  <svg
    class="spark"
    :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
    preserveAspectRatio="none"
    role="img"
    :height="HEIGHT"
  >
    <g v-for="(bar, index) in bars" :key="bar.at">
      <title>{{ bar.title }}</title>
      <rect
        v-if="bar.value === null"
        class="none"
        :x="x(index)"
        :y="HEIGHT - 2"
        :width="barWidth"
        height="2"
      />
      <template v-else>
        <!-- Прозрачная подложка во всю высоту — чтобы подсказка ловилась и на
             низком столбце. -->
        <rect class="hit" :x="x(index)" y="0" :width="barWidth" :height="HEIGHT" />
        <rect
          class="value"
          :x="x(index)"
          :y="HEIGHT - h(bar.value)"
          :width="barWidth"
          :height="h(bar.value)"
        />
        <rect
          v-if="bar.bad"
          class="bad"
          :x="x(index)"
          :y="HEIGHT - h(bar.bad)"
          :width="barWidth"
          :height="h(bar.bad)"
        />
      </template>
    </g>
  </svg>
</template>

<style scoped>
.spark {
  display: block;
  width: 100%;
}

.value {
  fill: var(--muted);
  opacity: 0.45;
}

.bad {
  fill: var(--danger);
}

.none {
  fill: var(--border);
}

.hit {
  fill: transparent;
}

g:hover .value {
  opacity: 0.8;
}
</style>
