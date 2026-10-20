import { describe, it, expect } from 'vitest';

import {
  FINANCE_ARTICLE_KEYS,
  FINANCE_ARTICLE_META,
  isFinanceArticle,
} from '../../src/modules/finance/finance-articles';
import { kopecksToRub, toKopecks } from '../../src/modules/finance/kopecks';
import {
  journalKeys,
  nettingRowToOperation,
  operationKeyOf,
  parseYmDate,
  parseYmDateTime,
} from '../../src/modules/finance/ym-journal';

/** Строка united-netting в той форме, в какой её отдал живой кабинет (TASK-108). */
const row = (over: Record<string, unknown> = {}) => ({
  orderId: 58841189889,
  shopSku: 'GA-2100-1A',
  offerOrServiceName: 'G-SHOCK GA-2100-1A',
  transactionType: 'Начисление',
  transactionSource: 'Платёж покупателя',
  transactionDate: '16.09.2026 14:05',
  actId: null,
  actDate: null,
  count: 1,
  transactionSum: 10499.9,
  paymentStatus: 'Будет переведён',
  bankOrderId: null,
  bankOrderDate: null,
  bankSum: null,
  model: 'FBS',
  ...over,
});

const ctx = {
  telegramUserId: '111',
  businessId: '164225008',
  documentId: 'd1',
  documentVersion: 1,
  periodKey: 'united-netting:2026-09-01:2026-09-30',
};

describe('journalKeys', () => {
  it('одинаковые строки — разные операции: #1 и #2', () => {
    const keys = journalKeys([row(), row()]);
    expect(keys[0].endsWith('#1')).toBe(true);
    expect(keys[1].endsWith('#2')).toBe(true);
    expect(new Set(keys).size).toBe(2);
  });

  it('порядок строк не меняет множество ключей', () => {
    const rows = [row(), row({ shopSku: 'B' }), row(), row({ transactionSum: -1 })];
    const reversed = [...rows].reverse();
    expect(new Set(journalKeys(reversed))).toEqual(new Set(journalKeys(rows)));
  });

  it('поля выплаты в ключ не входят — выплата не делает из операции новую', () => {
    const paid = row({
      paymentStatus: 'Переведён',
      bankOrderId: 777,
      bankOrderDate: '20.09.2026',
      bankSum: 10499.9,
    });
    expect(journalKeys([paid])).toEqual(journalKeys([row()]));
  });

  it('пересчитанная сумма — другой ключ (поэтому период заменяется версией)', () => {
    expect(journalKeys([row({ transactionSum: 10000 })])).not.toEqual(journalKeys([row()]));
  });

  it('хеш ключа — фиксированной длины и детерминирован', () => {
    const [key] = journalKeys([row()]);
    expect(operationKeyOf(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(operationKeyOf(key)).toBe(operationKeyOf(key));
  });
});

describe('toKopecks', () => {
  it('снимает float-дрейф: 0.1 + 0.2 → 30 копеек', () => {
    expect(toKopecks(0.1 + 0.2)).toBe(30);
  });

  it('тысяча сумм по копейке в копейках складываются точно', () => {
    const rubles = Array.from({ length: 1000 }, () => 0.01);
    expect(rubles.reduce((s, r) => s + r, 0)).not.toBe(10); // float — уже нет
    expect(rubles.reduce((s, r) => s + (toKopecks(r) ?? 0), 0)).toBe(1000);
  });

  it('строки с запятой, пробелами и знаком «−»', () => {
    expect(toKopecks('123,45')).toBe(12345);
    expect(toKopecks('−51 852,00')).toBe(-5185200);
    expect(toKopecks('1 000.5')).toBe(100050);
  });

  it('нечисловое — null, а не ноль', () => {
    expect(toKopecks(null)).toBeNull();
    expect(toKopecks('')).toBeNull();
    expect(toKopecks('abc')).toBeNull();
    expect(toKopecks(Number.NaN)).toBeNull();
  });

  it('ноль без знака и обратный перевод', () => {
    expect(Object.is(toKopecks(-0.001), 0)).toBe(true);
    expect(kopecksToRub(12345)).toBe(123.45);
  });
});

describe('даты ЯМ — по Москве', () => {
  it('«ДД.ММ.ГГГГ ЧЧ:ММ» — московское время', () => {
    expect(parseYmDateTime('16.09.2026 14:05')?.toISOString()).toBe('2026-09-16T11:05:00.000Z');
  });

  it('«ДД.ММ.ГГГГ» — начало московского дня', () => {
    expect(parseYmDate('30.09.2026')?.toISOString()).toBe('2026-09-29T21:00:00.000Z');
  });

  it('несуществующая дата и мусор — null', () => {
    expect(parseYmDate('31.02.2026')).toBeNull();
    expect(parseYmDateTime('2026-09-16')).toBeNull();
    expect(parseYmDate(null)).toBeNull();
  });
});

describe('nettingRowToOperation', () => {
  it('сумма в копейках, направление по знаку, статья — от классификатора', () => {
    const [key] = journalKeys([row()]);
    const op = nettingRowToOperation(row(), key, ctx);
    expect(op).toMatchObject({
      marketplace: 'ym',
      amountKopecks: 1049990,
      direction: 'income',
      article: 'sales',
      orderId: '58841189889',
      sku: 'GA-2100-1A',
      operationKey: operationKeyOf(key),
    });
    expect(op.paidAt).toBeUndefined();
    expect(op.raw).toEqual(row());
  });

  it('удержание — расход', () => {
    const r = row({
      transactionType: 'Удержание',
      transactionSource: 'Оплата услуг Маркета',
      offerOrServiceName: 'Размещение товарных предложений',
      transactionSum: -518.52,
    });
    const [key] = journalKeys([r]);
    expect(nettingRowToOperation(r, key, ctx)).toMatchObject({
      direction: 'expense',
      article: 'commission',
    });
  });

  it('незнакомый тип не теряется: операция есть, статья unknown', () => {
    const r = row({ transactionSource: 'Что-то новое' });
    const [key] = journalKeys([r]);
    expect(nettingRowToOperation(r, key, ctx)).toMatchObject({
      article: 'unknown',
      amountKopecks: 1049990,
    });
  });

  it('строка без суммы или даты не превращается в операцию на ноль', () => {
    expect(() => nettingRowToOperation(row({ transactionSum: null }), 'k', ctx)).toThrow();
    expect(() => nettingRowToOperation(row({ transactionDate: '' }), 'k', ctx)).toThrow();
  });
});

describe('статьи', () => {
  it('unknown — полноправная статья, у каждой есть подпись и группа', () => {
    expect(FINANCE_ARTICLE_KEYS).toContain('unknown');
    for (const key of FINANCE_ARTICLE_KEYS) {
      expect(FINANCE_ARTICLE_META[key].title).not.toBe('');
      expect(isFinanceArticle(key)).toBe(true);
    }
    expect(isFinanceArticle('toString')).toBe(false);
  });

  it('оплата баллами — справочная группа, не доход и не расход', () => {
    expect(FINANCE_ARTICLE_META.bonus_payment.group).toBe('reference');
  });
});
