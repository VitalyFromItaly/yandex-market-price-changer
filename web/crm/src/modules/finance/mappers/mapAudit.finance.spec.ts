import { describe, expect, it } from 'vitest';

import { toCorrectionRow, toDiscrepancyRow } from './mapAudit.finance';

import { toOperationRow } from '@/shared/finance-operations';
import { formatRub as rub } from '@/shared/utils';

describe('строки сверки и раскрытия', () => {
  it('операция: день по Москве, тип · источник, товар со штуками, документ', () => {
    const row = toOperationRow({
      id: 'op1',
      article: 'sales',
      articleTitle: 'Продажи',
      amountKopecks: 500_000,
      orderId: '1',
      sku: 'A1',
      count: 2,
      serviceName: null,
      transactionType: 'Начисление',
      transactionSource: 'Платёж покупателя',
      accruedAt: '2026-09-16T11:05:00.000Z',
      paidAt: null,
      actDate: null,
      bankOrderId: null,
      documentId: 'doc',
    });
    expect(row).toMatchObject({
      day: '16-09-2026',
      kind: 'Начисление · Платёж покупателя',
      order: '1',
      sku: 'A1 × 2',
      amount: rub(5000),
      negative: false,
      documentId: 'doc',
    });
  });

  it('сводная строка акта: в раскрытии статьи — её доля и «из …», без статьи — строка целиком', () => {
    const op = {
      id: 'op2',
      article: 'other_services',
      articleTitle: 'Прочие услуги',
      amountKopecks: -5_185_200,
      orderId: null,
      sku: null,
      count: null,
      serviceName: null,
      transactionType: 'Удержание',
      transactionSource: 'Оплата услуг Маркета',
      accruedAt: '2026-09-29T21:00:00.000Z',
      paidAt: null,
      actDate: null,
      bankOrderId: null,
      documentId: 'doc',
      parts: [
        { article: 'subscription', articleTitle: 'Абонентская плата', kopecks: -1_699_000 },
        { article: 'promotion', articleTitle: 'Продвижение', kopecks: -3_486_200 },
      ],
    };
    expect(toOperationRow(op, 'subscription')).toMatchObject({
      amount: rub(-16990),
      negative: true,
      partOf: `из ${rub(-51852)}`,
    });
    expect(toOperationRow(op).service).toContain('Абонентская плата');
    expect(toOperationRow(op)).toMatchObject({ amount: rub(-51852), partOf: null });
  });

  it('расхождение: ссылка на поручение и суммы; без сумм — null', () => {
    const row = toDiscrepancyRow(
      {
        kind: 'payment_mismatch',
        kindLabel: 'Сумма операций не равна выплате',
        orderId: null,
        bankOrderId: 'P1',
        operationIds: [],
        operationCount: 21,
        expectedKopecks: 100,
        actualKopecks: null,
        detail: 'Σ ≠ поручению',
      },
      0,
    );
    expect(row).toMatchObject({
      reference: 'Поручение № P1',
      expected: rub(1),
      actual: null,
      operations: '21 операция',
    });
  });

  it('корректировка: изменена — с новой суммой, убрана — без неё', () => {
    const side = {
      amountKopecks: 100,
      accruedAt: '2026-09-16T11:05:00.000Z',
      article: 'sales',
      articleTitle: 'Продажи',
      transactionType: 'Начисление',
      serviceName: null,
      orderId: '7',
      sku: null,
    };
    expect(
      toCorrectionRow(
        {
          kind: 'changed',
          documentVersion: 2,
          before: side,
          after: { ...side, amountKopecks: 90 },
          createdAt: 'x',
        },
        0,
      ),
    ).toMatchObject({
      kindLabel: 'Изменена',
      what: 'Продажи · заказ 7 · 16-09-2026',
      before: rub(1),
      after: rub(0.9),
      version: 'версия 2',
    });
    expect(
      toCorrectionRow(
        { kind: 'removed', documentVersion: 3, before: side, after: null, createdAt: 'y' },
        1,
      ).after,
    ).toBeNull();
  });
});
