import type { Purchase } from '../purchases.domain';

import { describe, expect, it } from 'vitest';

import {
  linesTotalText,
  mapPurchaseError,
  purchaseBody,
  toPurchaseForm,
  toPurchaseRow,
} from './mapPurchases.purchases';

import { ApiError } from '@/shared/http';

const NBSP = String.fromCharCode(0xa0);

const batch: Purchase = {
  id: 'p1',
  supplier: 'ООО Восток',
  paidDay: '2026-10-03',
  amountKopecks: 15_000_050,
  lines: [{ sku: 'W1', name: 'Часы', count: 3, priceKopecks: 5_000_000 }],
  note: null,
};

describe('toPurchaseRow', () => {
  it('день как в боте, рубли из копеек, число позиций', () => {
    expect(toPurchaseRow(batch)).toEqual({
      id: 'p1',
      supplier: 'ООО Восток',
      day: '03-10-2026',
      amount: `150${NBSP}000,5${NBSP}₽`,
      linesLabel: '1 позиция',
      note: null,
    });
    expect(toPurchaseRow({ ...batch, lines: null }).linesLabel).toBeNull();
  });
});

describe('форма закупки', () => {
  it('правка — значения записи; тело без пустых строк позиций', () => {
    const form = toPurchaseForm(batch, '2026-10-15');
    expect(form).toMatchObject({
      amount: '150000,5',
      lines: [{ sku: 'W1', count: '3', price: '50000' }],
    });
    const body = purchaseBody({
      ...form,
      note: '  ',
      lines: [...form.lines, { sku: '', name: '', count: '1', price: '' }],
    });
    expect(body.note).toBeNull();
    expect(body.lines).toEqual([{ sku: 'W1', name: 'Часы', count: '3', price: '50000' }]);
    expect(purchaseBody({ ...form, lines: [] }).lines).toBeNull();
  });

  it('новая — сегодня, без позиций', () => {
    expect(toPurchaseForm(null, '2026-10-15')).toEqual({
      supplier: '',
      paidDay: '2026-10-15',
      amount: '',
      note: '',
      lines: [],
    });
  });

  it('Σ позиций — подсказка; нечисло — null', () => {
    expect(
      linesTotalText([
        { sku: 'W1', name: '', count: '2', price: '1000,5' },
        { sku: 'W2', name: '', count: '1', price: '99' },
      ]),
    ).toBe(`2${NBSP}100${NBSP}₽`);
    expect(linesTotalText([{ sku: 'W1', name: '', count: 'два', price: '1' }])).toBeNull();
    expect(linesTotalText([])).toBeNull();
  });

  it('ошибка сервера с полем — под поле, иначе общей строкой', () => {
    const apiError = new ApiError(
      'Сумма позиций не равна сумме закупки',
      400,
      'INVALID_PURCHASE',
      'lines',
    );
    expect(mapPurchaseError(apiError, 'x')).toEqual({
      lines: 'Сумма позиций не равна сумме закупки',
    });
    expect(mapPurchaseError(new Error('сеть'), 'x')).toEqual({ form: 'сеть' });
  });
});
