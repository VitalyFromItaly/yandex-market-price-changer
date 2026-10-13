<script setup lang="ts">
/**
 * Несколько рядов по дням на Unovis — области с линией поверх, общий тултип
 * по перекрестию. Для сравнения величин одной шкалы (выручка и чистая).
 *
 * Правила кита (как у BarChart):
 * - цвет — только токен (`TONE_CSS`), тема меняется без перерисовки;
 * - одна ось Y на все ряды — разные шкалы на одном графике читаются ложно;
 * - легенда своя, на тех же токенах, тултип показывает все ряды дня;
 * - `label` описывает график для читалок экрана.
 * Ряды НЕ складываются: каждая область — от нуля, отрицательная уходит вниз.
 * Пропущенные дни заполняет вызывающий (`fillDays`): примитив рисует что дали.
 */
import type { ChartTone } from './chart.domain';

import { VisArea, VisAxis, VisCrosshair, VisTooltip, VisXYContainer } from '@unovis/vue';
import { computed } from 'vue';

import { TONE_CSS } from './chart.domain';

export interface AreaPoint {
  key: string;
  /** Подпись под осью и в тултипе («24-09»). */
  label: string;
  /** Заголовок тултипа, если нужен полнее подписи («24-09-2026»). */
  hint?: string;
  /** Значения рядов по ключу ряда. */
  values: Record<string, number>;
}

export interface AreaSeries {
  key: string;
  label: string;
  tone: ChartTone;
}

const props = withDefaults(
  defineProps<{
    points: readonly AreaPoint[];
    series: readonly AreaSeries[];
    label: string;
    format?: (value: number) => string;
    /** Короткий формат делений оси («12 тыс.»); по умолчанию — `format`. */
    axisFormat?: (value: number) => string;
    height?: number;
  }>(),
  {
    format: (value: number) => String(value),
    axisFormat: undefined,
    height: 220,
  },
);

interface Datum extends AreaPoint {
  i: number;
}
const data = computed<Datum[]>(() => props.points.map((p, i) => ({ ...p, i })));

const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const x = (d: Datum): number => d.i;
const valueOf =
  (key: string) =>
  (d: Datum): number =>
    d.values[key] ?? 0;
const accessors = computed(() => props.series.map((s) => valueOf(s.key)));
const crosshairColor = (_: Datum, i: number): string => TONE_CSS[props.series[i]?.tone ?? 'series'];

const escape = (text: string): string =>
  text.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
  );

function template(d: Datum): string {
  const rows = props.series
    .map(
      (s) =>
        `<div style="display:flex;align-items:center;gap:6px">` +
        `<span style="width:8px;height:8px;border-radius:9999px;background:${TONE_CSS[s.tone]}"></span>` +
        `<span style="opacity:.7">${escape(s.label)}</span>` +
        `<span style="margin-left:auto;padding-left:12px;font-weight:600;font-variant-numeric:tabular-nums">` +
        `${escape(props.format(d.values[s.key] ?? 0))}</span></div>`,
    )
    .join('');
  return (
    `<div style="font-size:12px;line-height:1.5">` +
    `<div style="opacity:.7;margin-bottom:2px">${escape(d.hint ?? d.label)}</div>${rows}</div>`
  );
}

const xTick = (tick: number | Date): string => data.value[Number(tick)]?.label ?? '';
const yTick = (tick: number | Date): string => (props.axisFormat ?? props.format)(Number(tick));
</script>

<template>
  <div class="flex w-full flex-col gap-2">
    <ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden="true">
      <li v-for="s in series" :key="s.key" class="flex items-center gap-1.5">
        <span class="size-2 rounded-full" :style="{ background: TONE_CSS[s.tone] }" />
        {{ s.label }}
      </li>
    </ul>
    <div role="img" :aria-label="label" class="w-full">
      <VisXYContainer
        :data="data"
        :height="height"
        :duration="reducedMotion ? 0 : undefined"
        :margin="{ top: 8, right: 4 }"
      >
        <VisArea
          v-for="(s, index) in series"
          :key="s.key"
          :x="x"
          :y="accessors[index]"
          :color="TONE_CSS[s.tone]"
          :opacity="0.14"
          :line="true"
          :line-color="TONE_CSS[s.tone]"
          :line-width="2"
          curve-type="monotoneX"
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
        <VisCrosshair :x="x" :y="accessors" :color="crosshairColor" :template="template" />
        <VisTooltip />
      </VisXYContainer>
    </div>
  </div>
</template>
