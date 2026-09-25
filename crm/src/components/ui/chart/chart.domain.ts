/**
 * Чистая часть кита графиков: тона и геометрия. Компоненты только рисуют —
 * доли и отступы считаются здесь и проверяются спеком.
 *
 * Тон — смысл цвета, а не цвет: `series` (одиночный ряд), категориальные
 * слоты `c1…c6` (в ФИКСИРОВАННОМ порядке палитры, по кругу не красить),
 * статусы `ok`/`warn`/`danger`, акцент `brand`, фоновый `muted`. Классы
 * записаны литералами — Tailwind видит только полные имена.
 */
export type ChartTone =
  | 'series'
  | 'c1'
  | 'c2'
  | 'c3'
  | 'c4'
  | 'c5'
  | 'c6'
  | 'ok'
  | 'warn'
  | 'danger'
  | 'brand'
  | 'muted';

export const TONE_BG: Record<ChartTone, string> = {
  series: 'bg-chart-series',
  c1: 'bg-chart-1',
  c2: 'bg-chart-2',
  c3: 'bg-chart-3',
  c4: 'bg-chart-4',
  c5: 'bg-chart-5',
  c6: 'bg-chart-6',
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  brand: 'bg-brand',
  muted: 'bg-muted-foreground/40',
};

/** Для SVG (Unovis): тот же тон как CSS-цвет — тема меняется без перерисовки. */
export const TONE_CSS: Record<ChartTone, string> = {
  series: 'hsl(var(--chart-series))',
  c1: 'hsl(var(--chart-1))',
  c2: 'hsl(var(--chart-2))',
  c3: 'hsl(var(--chart-3))',
  c4: 'hsl(var(--chart-4))',
  c5: 'hsl(var(--chart-5))',
  c6: 'hsl(var(--chart-6))',
  ok: 'hsl(var(--ok))',
  warn: 'hsl(var(--warn))',
  danger: 'hsl(var(--danger))',
  brand: 'hsl(var(--brand))',
  muted: 'hsl(var(--muted-foreground) / 0.4)',
};

/** Доля 0…1; мусор и деление на ноль — 0, а не NaN в ширине полосы. */
export function ratio(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(1, Math.max(0, value / max));
}

/** «22 %» от доли; меньше процента, но не ноль — «<1 %», чтобы не читалось как «нет». */
export function formatShare(part: number, whole: number): string {
  if (!whole) return '—';
  const pct = (part / whole) * 100;
  if (pct !== 0 && Math.abs(pct) < 1) return pct > 0 ? '<1 %' : '>−1 %';
  return `${Math.round(pct)} %`;
}

export interface Segment<K extends string = string> {
  key: K;
  label: string;
  value: number;
  tone: ChartTone;
}

export interface PlacedSegment<K extends string = string> extends Segment<K> {
  /** Ширина в долях всей полосы, 0…1. */
  share: number;
}

/**
 * Сегменты одной полосы: нулевые и отрицательные выпадают (у доли нет
 * отрицательной ширины), остальные делят полосу пропорционально.
 */
export function placeSegments<K extends string>(
  segments: readonly Segment<K>[],
): PlacedSegment<K>[] {
  const visible = segments.filter((s) => Number.isFinite(s.value) && s.value > 0);
  const total = visible.reduce((sum, s) => sum + s.value, 0);
  return visible.map((s) => ({ ...s, share: ratio(s.value, total) }));
}

export type StepKind = 'plus' | 'minus' | 'total' | 'info';

export interface WaterfallInput {
  value: number;
  kind: StepKind;
}

/** Отрезок ступени в долях шкалы: `left` и `width` 0…1. `null` — у справочной строки полосы нет. */
export interface WaterfallStep {
  left: number;
  width: number;
}

/**
 * Водопад «Продажи → вычеты → Чистая»: `plus` поднимает уровень, `minus`
 * опускает, `total` рисуется от нуля (итог сверяется с уровнем глазами).
 * `info` — справочная строка (калькулятор рядом с комиссией): в арифметику
 * не входит, полосы у неё нет. Шкала включает ноль и уходит влево, если
 * чистая отрицательная, — убыток виден как полоса по ту сторону нуля.
 */
export function waterfallSteps(rows: readonly WaterfallInput[]): (WaterfallStep | null)[] {
  let level = 0;
  const spans = rows.map((row): [number, number] | null => {
    if (row.kind === 'info') return null;
    if (row.kind === 'total') return [0, row.value];
    const from = level;
    level += row.kind === 'plus' ? row.value : -row.value;
    return [from, level];
  });
  const points = spans.flatMap((s) => (s === null ? [] : s));
  const lo = Math.min(0, ...points);
  const hi = Math.max(0, ...points);
  const range = hi - lo;
  if (!range) return spans.map((s) => (s === null ? null : { left: 0, width: 0 }));
  return spans.map((s) => {
    if (s === null) return null;
    const [a, b] = s[0] <= s[1] ? s : [s[1], s[0]];
    return { left: (a - lo) / range, width: (b - a) / range };
  });
}

/**
 * Расходящаяся полоса: центр — ноль, `value` в пределах ±`max`. Возвращает
 * отрезок в долях всей ширины.
 */
export function divergingStep(value: number, max: number): WaterfallStep {
  const half = ratio(Math.abs(value), max) / 2;
  return value >= 0 ? { left: 0.5, width: half } : { left: 0.5 - half, width: half };
}
