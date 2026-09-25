import { describe, expect, it } from 'vitest';

import { divergingStep, formatShare, placeSegments, ratio, waterfallSteps } from './chart.domain';

describe('chart.domain', () => {
  it('ratio: мусор и деление на ноль — 0, выход за шкалу — обрезан', () => {
    expect(ratio(5, 0)).toBe(0);
    expect(ratio(Number.NaN, 10)).toBe(0);
    expect(ratio(15, 10)).toBe(1);
    expect(ratio(-1, 10)).toBe(0);
    expect(ratio(2.5, 10)).toBe(0.25);
  });

  it('formatShare: крошечная доля — «<1 %», а не «0 %»', () => {
    expect(formatShare(22, 100)).toBe('22 %');
    expect(formatShare(0.3, 100)).toBe('<1 %');
    expect(formatShare(0, 100)).toBe('0 %');
    expect(formatShare(1, 0)).toBe('—');
  });

  it('placeSegments: нули выпадают, доли в сумме — единица', () => {
    const placed = placeSegments([
      { key: 'a', label: 'A', value: 3, tone: 'c1' },
      { key: 'b', label: 'B', value: 0, tone: 'c2' },
      { key: 'c', label: 'C', value: 1, tone: 'c3' },
    ]);
    expect(placed.map((s) => s.key)).toEqual(['a', 'c']);
    expect(placed.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1);
    expect(placed[0]?.share).toBe(0.75);
  });

  it('waterfallSteps: продажи → вычеты → чистая, справочная строка без полосы', () => {
    const steps = waterfallSteps([
      { value: 100, kind: 'plus' },
      { value: 20, kind: 'minus' },
      { value: 25, kind: 'info' },
      { value: 50, kind: 'minus' },
      { value: 30, kind: 'total' },
    ]);
    expect(steps[0]).toEqual({ left: 0, width: 1 });
    expect(steps[1]).toEqual({ left: 0.8, width: 0.2 });
    expect(steps[2]).toBeNull();
    expect(steps[3]).toEqual({ left: 0.3, width: 0.5 });
    expect(steps[4]).toEqual({ left: 0, width: 0.3 });
  });

  it('waterfallSteps: убыток уходит по ту сторону нуля', () => {
    const steps = waterfallSteps([
      { value: 100, kind: 'plus' },
      { value: 125, kind: 'minus' },
      { value: -25, kind: 'total' },
    ]);
    // Шкала −25…100: ноль на 0.2.
    expect(steps[0]).toEqual({ left: 0.2, width: 0.8 });
    expect(steps[2]).toEqual({ left: 0, width: 0.2 });
  });

  it('divergingStep: плюс вправо от центра, минус влево', () => {
    expect(divergingStep(50, 100)).toEqual({ left: 0.5, width: 0.25 });
    expect(divergingStep(-100, 100)).toEqual({ left: 0, width: 0.5 });
  });
});
