import { describe, expect, it } from 'vitest';

import {
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
