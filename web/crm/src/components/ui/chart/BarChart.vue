<script setup lang="ts">
/**
 * Столбцы одного ряда на Unovis — ряд по дням и подобное, где нужны оси,
 * сетка и наведение. Полосы внутри строк (доли, водопад) — это DataBar и
 * SegmentBar на CSS: у них подписи — строки таблицы, ось им не нужна.
 *
 * Правила кита (скил frontend-design / dataviz):
 * - цвет — только токен (`TONE_CSS`), тема меняется без перерисовки;
 * - одна ось Y, тонкие столбцы, сетка приглушена, тултип на каждом столбце;
 * - график — дополнение к таблице рядом, а не её замена: `label` описывает,
 *   что показано, для читалок экрана;
 * - `selectable`: клик по столбцу выбирает его ключ (повторный — снимает),
 *   экран фильтрует таблицу. Невыбранные приглушаются.
 */
import type { ChartTone } from './chart.domain';

import { StackedBar } from '@unovis/ts';
import { VisAxis, VisStackedBar, VisTooltip, VisXYContainer } from '@unovis/vue';
import { computed } from 'vue';

import { TONE_CSS } from './chart.domain';

export interface BarPoint {
  key: string;
  /** Подпись под столбцом и в тултипе («24-09»). */
  label: string;
  value: number;
  /** Строка тултипа целиком, если нужна богаче «подпись: значение». */
  hint?: string;
}

const props = withDefaults(
  defineProps<{
    points: readonly BarPoint[];
    label: string;
    format?: (value: number) => string;
    /** Короткий формат делений оси («12 тыс.»); по умолчанию — `format`. */
    axisFormat?: (value: number) => string;
    tone?: ChartTone;
    height?: number;
    selectable?: boolean;
    selected?: string | null;
  }>(),
  {
    format: (value: number) => String(value),
    axisFormat: undefined,
    tone: 'series',
    height: 200,
    selectable: false,
    selected: null,
  },
);
const emit = defineEmits<{ select: [string | null] }>();

interface Datum extends BarPoint {
  i: number;
}
const data = computed<Datum[]>(() => props.points.map((p, i) => ({ ...p, i })));

const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const x = (d: Datum): number => d.i;
const y = [(d: Datum): number => d.value];
const color = (d: Datum): string =>
  props.selected !== null && props.selected !== d.key ? TONE_CSS.muted : TONE_CSS[props.tone];

const escape = (text: string): string =>
  text.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
  );

const tooltip = computed(() => ({
  [StackedBar.selectors.bar]: (d: Datum) =>
    `<div style="font-size:12px;line-height:1.4"><div style="opacity:.7">${escape(d.label)}</div>` +
    `<div style="font-weight:600;font-variant-numeric:tabular-nums">${escape(d.hint ?? props.format(d.value))}</div></div>`,
}));

const events = computed(() => ({
  [StackedBar.selectors.bar]: {
    click: (d: Datum) => {
      if (props.selectable) emit('select', props.selected === d.key ? null : d.key);
    },
  },
}));

const xTick = (tick: number | Date): string => data.value[Number(tick)]?.label ?? '';
const yTick = (tick: number | Date): string => (props.axisFormat ?? props.format)(Number(tick));
</script>

<template>
  <div role="img" :aria-label="label" class="w-full">
    <VisXYContainer
      :data="data"
      :height="height"
      :duration="reducedMotion ? 0 : undefined"
      :margin="{ top: 8, right: 4 }"
      :y-domain-min-constraint="[undefined, 0]"
    >
      <VisStackedBar
        :x="x"
        :y="y"
        :color="color"
        :data-step="1"
        :bar-padding="0.25"
        :rounded-corners="4"
        :bar-max-width="40"
        :cursor="selectable ? 'pointer' : null"
        :events="events"
      />
      <VisAxis
        type="x"
        :tick-format="xTick"
        :grid-line="false"
        :tick-line="false"
        :tick-text-hide-overlapping="true"
      />
      <VisAxis
        type="y"
        :tick-format="yTick"
        :num-ticks="4"
        :domain-line="false"
        :tick-line="false"
      />
      <VisTooltip :triggers="tooltip" />
    </VisXYContainer>
  </div>
</template>
