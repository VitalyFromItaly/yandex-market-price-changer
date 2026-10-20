import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FINANCE_ARTICLE_META, isFinanceArticle } from '../../src/modules/finance/finance-articles';
import { breakdownOf, expandBreakdown } from '../../src/modules/finance/operation-breakdown';
import {
  YM_ACT_ORDER_SHEETS,
  YM_ACT_SUMMARY_SHEETS,
  ymActBreakdownOf,
  ymActDayOf,
  ymActServicesTotalOf,
} from '../../src/modules/finance/ym-act-breakdown';
import { classifyYmRow, isYmActSummaryRow } from '../../src/modules/finance/ym-articles';

const sheet = (...rows: Record<string, unknown>[]) => ({ rows });
const service = (servicePrice: unknown, actDate = '2026-09-30') => ({ servicePrice, actDate });

/** Акт 30.09.2026 живого кабинета 164225008 — суммы листов из дампа 18-10-2026. */
const SEPTEMBER = new Map<string, unknown>([
  ['business_subscription', sheet(service(16990))],
  ['pushes', sheet(service(1208), service(25495))],
  ['export_from_warehouse', sheet(service(36), service(1088))],
  ['order_processing', sheet(service(1845))],
  ['order_processing_on_warehouse', sheet(service(1635))],
  ['storage_of_returns', sheet(service(3555))],
  // Удерживаются по заказу — в сводную строку не входят.
  ['placement', sheet({ totalAmount: 252, servicePrice: 252, actDate: '2026-09-30' })],
  ['delivery', sheet(service(127019.95))],
]);

describe('ymActBreakdownOf — сводная строка акта по отчёту услуг', () => {
  it('акт 30.09.2026: −51 852 раскладывается до копейки, остатка нет', () => {
    const result = ymActBreakdownOf(-5185200, '2026-09-30', SEPTEMBER);

    expect(result?.remainderKopecks).toBe(0);
    expect(result?.unknownSheets).toEqual([]);
    expect(result?.parts).toEqual([
      { article: 'subscription', kopecks: -1699000, sheet: 'business_subscription' },
      { article: 'storage', kopecks: -112400, sheet: 'export_from_warehouse' },
      { article: 'processing', kopecks: -184500, sheet: 'order_processing' },
      { article: 'processing', kopecks: -163500, sheet: 'order_processing_on_warehouse' },
      { article: 'promotion', kopecks: -2670300, sheet: 'pushes' },
      { article: 'storage', kopecks: -355500, sheet: 'storage_of_returns' },
    ]);
    expect(result?.parts.reduce((s, p) => s + p.kopecks, 0)).toBe(-5185200);
  });

  it('берёт только строки своего акта: отчёт за месяц несёт и чужие даты', () => {
    const sheets = new Map<string, unknown>([
      ['pushes', sheet(service(100), service(999, '2026-08-31'))],
    ]);
    expect(ymActBreakdownOf(-10000, '2026-09-30', sheets)?.parts).toEqual([
      { article: 'promotion', kopecks: -10000, sheet: 'pushes' },
    ]);
  });

  it('не сошлось — остаток отдельной частью unknown, без подгонки', () => {
    const result = ymActBreakdownOf(-5200000, '2026-09-30', SEPTEMBER);
    expect(result?.remainderKopecks).toBe(-14800);
    expect(result?.parts.at(-1)).toEqual({ article: 'unknown', kopecks: -14800, sheet: null });
    expect(result?.parts.reduce((s, p) => s + p.kopecks, 0)).toBe(-5200000);
  });

  it('лист без правила не угадывается: виден в unknownSheets, сумма — в остатке', () => {
    const sheets = new Map<string, unknown>([
      ['pushes', sheet(service(100))],
      ['brand_new_service', sheet(service(50))],
    ]);
    const result = ymActBreakdownOf(-15000, '2026-09-30', sheets);
    expect(result?.unknownSheets).toEqual(['brand_new_service']);
    expect(result?.remainderKopecks).toBe(-5000);
  });

  it('строк этого акта в отчёте нет — null, а не «всё в остатке»', () => {
    expect(ymActBreakdownOf(-4720389, '2026-08-31', SEPTEMBER)).toBeNull();
  });

  it('строка без числа servicePrice не считается нулём молча — разница уходит в остаток', () => {
    const sheets = new Map<string, unknown>([['pushes', sheet(service(100), service('—'))]]);
    expect(ymActBreakdownOf(-20000, '2026-09-30', sheets)?.remainderKopecks).toBe(-10000);
  });

  it('дата акта журнала «ДД.ММ.ГГГГ» → день отчёта услуг', () => {
    expect(ymActDayOf('30.09.2026')).toBe('2026-09-30');
    expect(ymActDayOf('2026-09-30')).toBeNull();
    expect(ymActDayOf(null)).toBeNull();
  });
});

describe('таблицы листов', () => {
  it('у каждого сводного листа — настоящая статья расхода', () => {
    for (const article of Object.values(YM_ACT_SUMMARY_SHEETS)) {
      expect(isFinanceArticle(article)).toBe(true);
      expect(FINANCE_ARTICLE_META[article].group).toBe('expense');
    }
  });

  it('лист не бывает сразу сводным и «по заказу»', () => {
    for (const name of YM_ACT_ORDER_SHEETS) expect(YM_ACT_SUMMARY_SHEETS[name]).toBeUndefined();
  });

  it('решение владельца: подписка — своя статья, пуши — продвижение, вывоз — хранение', () => {
    expect(YM_ACT_SUMMARY_SHEETS).toMatchObject({
      business_subscription: 'subscription',
      pushes: 'promotion',
      export_from_warehouse: 'storage',
      order_processing: 'processing',
      order_processing_on_warehouse: 'processing',
      storage_of_returns: 'storage',
    });
  });

  it('лист: импортирует только листы статей, копеек и типа расшифровки', () => {
    const source = readFileSync(
      join(__dirname, '../../src/modules/finance/ym-act-breakdown.ts'),
      'utf8',
    );
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(['./finance-articles', './kopecks', './operation-breakdown']);
  });
});

describe('isYmActSummaryRow — тот же признак, что ветка классификатора', () => {
  const summary = {
    transactionType: 'Удержание',
    transactionSource: 'Оплата услуг Маркета',
    offerOrServiceName: null,
  };

  it('сводная строка: признак есть, статья колонки остаётся other_services', () => {
    expect(isYmActSummaryRow(summary)).toBe(true);
    expect(classifyYmRow(summary).article).toBe('other_services');
  });

  it('удержание за услугу с названием и сторно без названия — не сводная', () => {
    expect(isYmActSummaryRow({ ...summary, offerOrServiceName: 'Доставка покупателю' })).toBe(
      false,
    );
    expect(isYmActSummaryRow({ ...summary, transactionType: 'Начисление' })).toBe(false);
  });
});

describe('expandBreakdown — развёртка при чтении', () => {
  const op = (breakdown: unknown, amountKopecks = -5185200) => ({
    id: 'op-1',
    article: 'other_services' as const,
    amountKopecks,
    paidAt: null,
    breakdown,
  });
  const parts = ymActBreakdownOf(-5185200, '2026-09-30', SEPTEMBER)?.parts;

  it('по строке на статью, части одной статьи сложены, Σ = сумме операции', () => {
    const lines = expandBreakdown([op(parts)]);
    expect(lines.map((l) => [l.article, l.amountKopecks])).toEqual([
      ['subscription', -1699000],
      ['storage', -467900],
      ['processing', -348000],
      ['promotion', -2670300],
    ]);
    expect(lines.every((l) => l.id === 'op-1' && !('breakdown' in l))).toBe(true);
    expect(lines.reduce((s, l) => s + l.amountKopecks, 0)).toBe(-5185200);
  });

  it('без расшифровки или с несходящейся — операция целиком своей статьёй', () => {
    expect(expandBreakdown([op(null)])).toEqual([
      { id: 'op-1', article: 'other_services', amountKopecks: -5185200, paidAt: null },
    ]);
    expect(expandBreakdown([op(parts, -100)])).toHaveLength(1);
  });

  it('битая запись в базе — не расшифровка', () => {
    expect(breakdownOf([{ article: 'nope', kopecks: 1, sheet: null }])).toBeNull();
    expect(breakdownOf([{ article: 'storage', kopecks: 1.5, sheet: null }])).toBeNull();
    expect(breakdownOf({})).toBeNull();
    expect(breakdownOf([])).toBeNull();
  });
});

describe('ymActServicesTotalOf — итог акта для сверки (TASK-158)', () => {
  it('Σ всех листов: у «Размещения» totalAmount, у остальных servicePrice', () => {
    const sheets = new Map<string, unknown>([
      ['placement', sheet({ servicePrice: 300, totalAmount: 252, actDate: '2026-09-30' })],
      ['pushes', sheet(service(26703))],
      ['delivery', sheet(service('1 000,50'))],
    ]);
    expect(ymActServicesTotalOf('2026-09-30', sheets)).toEqual({
      actDay: '2026-09-30',
      totalKopecks: 2795550,
      sheets: { delivery: 100050, placement: 25200, pushes: 2670300 },
    });
  });

  it('строки чужого акта не считаются; нет строк акта — null, а не ноль', () => {
    const sheets = new Map<string, unknown>([
      ['pushes', sheet(service(100), service(500, '2026-08-31T00:00:00'))],
    ]);
    expect(ymActServicesTotalOf('2026-09-30', sheets)?.totalKopecks).toBe(10000);
    expect(ymActServicesTotalOf('2026-10-31', sheets)).toBeNull();
  });
});
