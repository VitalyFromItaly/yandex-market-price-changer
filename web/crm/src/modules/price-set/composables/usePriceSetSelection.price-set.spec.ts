import type { PriceSetPlan, PriceSetTarget } from '../price-set.domain';

import { describe, expect, it } from 'vitest';
import { nextTick, ref } from 'vue';

import { usePriceSetSelection } from './usePriceSetSelection.price-set';

const target = (marketplace: 'ym' | 'wb', willWrite = true): PriceSetTarget => ({
  marketplace,
  marketplaceLabel: marketplace,
  blockedBy: null,
  blockedText: null,
  error: null,
  updates: [
    {
      key: `${marketplace}:a`,
      sku: 'a',
      mpSku: 'a',
      name: null,
      from: 100,
      to: 110,
      deltaPct: 10,
      risky: false,
    },
    {
      key: `${marketplace}:b`,
      sku: 'b',
      mpSku: 'b',
      name: null,
      from: null,
      to: 500,
      deltaPct: null,
      risky: true,
    },
  ],
  unchanged: 0,
  skipped: [],
  willWrite,
});

const plan = (hash: string, targets: PriceSetTarget[]): PriceSetPlan => ({
  takenAt: '',
  source: 'markup',
  planHash: hash,
  priceListAt: null,
  writeOpen: true,
  writeCount: 0,
  notes: [],
  notConsidered: [],
  fileBad: [],
  targets,
});

describe('usePriceSetSelection', () => {
  it('по умолчанию: все записываемые площадки, рискованные строки сняты', () => {
    const selection = usePriceSetSelection(ref(plan('h1', [target('ym'), target('wb', false)])));

    expect(selection.isSelected('ym')).toBe(true);
    expect(selection.isSelected('wb')).toBe(false);
    expect(selection.isIncluded('ym:b')).toBe(false);
    expect(selection.count.value).toBe(1);
    expect(selection.excludedKeys.value).toEqual(expect.arrayContaining(['ym:b', 'wb:b']));
  });

  it('галочка строки и площадки меняют число к записи; закрытую площадку не отметить', () => {
    const selection = usePriceSetSelection(ref(plan('h1', [target('ym'), target('wb', false)])));

    selection.toggleRow('ym:b', true);
    expect(selection.count.value).toBe(2);
    selection.toggle('wb', true);
    expect(selection.isSelected('wb')).toBe(false);
    selection.toggle('ym', false);
    expect(selection.count.value).toBe(0);
    expect(selection.marketplaces.value).toEqual([]);
  });

  it('новый план снова ставит умолчания', async () => {
    const current = ref(plan('h1', [target('ym')]));
    const selection = usePriceSetSelection(current);
    selection.toggleRow('ym:b', true);
    selection.toggleRow('ym:a', false);

    current.value = plan('h2', [target('ym')]);
    await nextTick();

    expect(selection.isIncluded('ym:a')).toBe(true);
    expect(selection.isIncluded('ym:b')).toBe(false);
  });
});
