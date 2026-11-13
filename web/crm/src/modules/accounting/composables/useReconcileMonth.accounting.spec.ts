import { describe, expect, it } from 'vitest';

import { useReconcileMonth } from './useReconcileMonth.accounting';

describe('useReconcileMonth', () => {
  it('только закрытые месяцы, по умолчанию — прошлый', () => {
    const { month, options, label } = useReconcileMonth('2026-11-08');
    expect(month.value).toBe('2026-10');
    expect(label.value).toBe('Октябрь 2026');
    expect(options.value).toHaveLength(12);
    expect(options.value.map((o) => o.value)).not.toContain('2026-11');
    expect(options.value.at(-1)?.value).toBe('2025-11');
  });

  it('январь — прошлый месяц в прошлом году', () => {
    expect(useReconcileMonth('2027-01-03').month.value).toBe('2026-12');
  });
});
