import { describe, expect, it } from 'vitest';

import {
  doubleCountArticleOf,
  doubleCountWarningOf,
  expenseRecognitionWindow,
  isIsoDay,
  isUuid,
  validateCategoryName,
  validateExpenseInput,
} from '../../src/modules/finance/expense.domain';

const CUSTOM = '7b0e2a8c-3c1d-4f5e-9a6b-1c2d3e4f5a6b';
const ok = { kind: 'monthly', category: 'rent', amount: '30 000', fromDay: '2026-10-01' };

describe('validateExpenseInput', () => {
  it('рубли строкой с пробелами → копейки; пустой конец и заметка → null', () => {
    expect(validateExpenseInput({ ...ok, toDay: '', note: '  ' }, new Set())).toEqual({
      ok: true,
      value: {
        kind: 'monthly',
        category: 'rent',
        amountKopecks: 3_000_000,
        fromDay: '2026-10-01',
        toDay: null,
        note: null,
        source: null,
        scope: null,
        marketplace: null,
        orderId: null,
        sku: null,
      },
    });
  });

  it('своя категория — по uuid из списка продавца, чужая — отказ', () => {
    expect(validateExpenseInput({ ...ok, category: CUSTOM }, new Set([CUSTOM])).ok).toBe(true);
    expect(validateExpenseInput({ ...ok, category: CUSTOM }, new Set())).toMatchObject({
      ok: false,
      field: 'category',
    });
  });

  it.each([
    [{ kind: 'weekly' }, 'kind'],
    [{ category: 'toString' }, 'category'],
    [{ amount: 'abc' }, 'amount'],
    [{ amount: 0 }, 'amount'],
    [{ amount: -5 }, 'amount'],
    [{ amount: 1e11 }, 'amount'],
    [{ fromDay: '2026-02-30' }, 'fromDay'],
    [{ fromDay: '01-10-2026' }, 'fromDay'],
    [{ toDay: '2026-09-30' }, 'toDay'],
    [{ toDay: 'потом' }, 'toDay'],
    [{ note: 'x'.repeat(201) }, 'note'],
  ])('%j → ошибка поля %s', (patch, field) => {
    expect(validateExpenseInput({ ...ok, ...patch }, new Set())).toMatchObject({
      ok: false,
      field,
    });
  });

  it('у разового конца нет — присланный toDay игнорируется', () => {
    const result = validateExpenseInput(
      { ...ok, kind: 'one_off', toDay: '2026-12-31', amount: 1250.5 },
      new Set(),
    );
    expect(result).toMatchObject({ ok: true, value: { toDay: null, amountKopecks: 125_050 } });
  });
});

describe('validateCategoryName', () => {
  it('обрезает и схлопывает пробелы', () => {
    expect(validateCategoryName('  Реклама   у блогеров ', [])).toEqual({
      ok: true,
      value: 'Реклама у блогеров',
    });
  });

  it('повтор предустановленной или своей — без учёта регистра — отказ', () => {
    expect(validateCategoryName('аренда', []).ok).toBe(false);
    expect(validateCategoryName('РЕКЛАМА', ['Реклама']).ok).toBe(false);
    expect(validateCategoryName('', []).ok).toBe(false);
    expect(validateCategoryName('x'.repeat(61), []).ok).toBe(false);
  });
});

describe('isIsoDay / isUuid', () => {
  it('день существует и в формате ГГГГ-ММ-ДД', () => {
    expect(isIsoDay('2028-02-29')).toBe(true);
    expect(isIsoDay('2026-02-29')).toBe(false);
    expect(isIsoDay(20261001)).toBe(false);
  });

  it('uuid — иначе Postgres ответил бы ошибкой синтаксиса, а не «нет строки»', () => {
    expect(isUuid(CUSTOM)).toBe(true);
    expect(isUuid('abc')).toBe(false);
  });
});

describe('расходы v2 (TASK-220)', () => {
  const base = { category: 'packaging', amount: 500, fromDay: '2026-10-01' };

  it('«за период» требует конец не раньше начала', () => {
    expect(validateExpenseInput({ ...base, kind: 'period' }, new Set())).toMatchObject({
      ok: false,
      field: 'toDay',
    });
    expect(
      validateExpenseInput({ ...base, kind: 'period', toDay: '2026-09-30' }, new Set()),
    ).toMatchObject({ ok: false, field: 'toDay' });
    expect(
      validateExpenseInput({ ...base, kind: 'period', toDay: '2026-12-31' }, new Set()),
    ).toMatchObject({ ok: true, value: { kind: 'period', toDay: '2026-12-31' } });
  });

  it('у разового конец не хранится', () => {
    expect(
      validateExpenseInput({ ...base, kind: 'one_off', toDay: '2026-12-31' }, new Set()),
    ).toMatchObject({ ok: true, value: { toDay: null } });
  });

  it.each([
    [{ scope: 'shop' }, 'scope'],
    [{ scope: 'marketplace' }, 'marketplace'],
    [{ scope: 'marketplace', marketplace: 'amazon' }, 'marketplace'],
    [{ scope: 'order', marketplace: 'ym' }, 'orderId'],
    [{ scope: 'product', sku: '  ' }, 'sku'],
    [{ source: 42 }, 'source'],
    [{ source: 'x'.repeat(201) }, 'source'],
  ])('привязка %o → ошибка под полем %s', (patch, field) => {
    expect(validateExpenseInput({ ...base, kind: 'one_off', ...patch }, new Set())).toMatchObject({
      ok: false,
      field,
    });
  });

  it('привязка хранит только свои поля; товар — без площадки можно', () => {
    expect(
      validateExpenseInput(
        { ...base, kind: 'one_off', scope: 'order', marketplace: 'ozon', orderId: ' 77 ', sku: 'A1' },
        new Set(),
      ),
    ).toMatchObject({
      ok: true,
      value: { scope: 'order', marketplace: 'ozon', orderId: '77', sku: null },
    });
    expect(
      validateExpenseInput(
        { ...base, kind: 'one_off', scope: 'product', sku: 'A1', source: ' Чек 5 ' },
        new Set(),
      ),
    ).toMatchObject({
      ok: true,
      value: { scope: 'product', marketplace: null, sku: 'A1', source: 'Чек 5' },
    });
    expect(
      validateExpenseInput(
        { ...base, kind: 'one_off', scope: 'business', marketplace: 'ym', orderId: '1' },
        new Set(),
      ),
    ).toMatchObject({ ok: true, value: { scope: 'business', marketplace: null, orderId: null } });
  });

  it('окно признания — целые месяцы', () => {
    const today = '2026-11-10';
    expect(expenseRecognitionWindow({ kind: 'one_off', fromDay: '2026-10-05', toDay: null }, today))
      .toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(
      expenseRecognitionWindow({ kind: 'monthly', fromDay: '2026-09-15', toDay: null }, today),
    ).toEqual({ from: '2026-09-01', to: '2026-11-30' });
    expect(
      expenseRecognitionWindow({ kind: 'period', fromDay: '2026-02-10', toDay: '2026-02-20' }, today),
    ).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('двойной учёт: подписка/реклама/хранение, та же площадка и окно', () => {
    const sub = {
      kind: 'monthly' as const,
      category: 'marketplace_subscriptions',
      fromDay: '2026-10-01',
      toDay: '2026-10-31',
      marketplace: null,
    };
    const accrual = {
      article: 'subscription' as const,
      marketplace: 'ozon' as const,
      accruedOn: '2026-10-31',
    };
    const today = '2026-11-10';
    expect(doubleCountArticleOf(sub, [accrual], today)).toBe('subscription');
    expect(doubleCountArticleOf({ ...sub, marketplace: 'ym' }, [accrual], today)).toBeNull();
    expect(doubleCountArticleOf(sub, [{ ...accrual, accruedOn: '2026-11-01' }], today)).toBeNull();
    expect(doubleCountArticleOf(sub, [{ ...accrual, article: 'storage' }], today)).toBeNull();
    expect(doubleCountArticleOf({ ...sub, category: 'rent' }, [accrual], today)).toBeNull();
    expect(
      doubleCountArticleOf(
        { ...sub, category: 'warehouse' },
        [{ ...accrual, article: 'storage' }],
        today,
      ),
    ).toBe('storage');
    expect(doubleCountWarningOf('subscription')).toContain('«Абонентская плата»');
    expect(doubleCountWarningOf(null)).toBeNull();
  });
});
