import type { ReconcileLineResponse, ReconcileResponse } from '../accounting.domain';

import { describe, expect, it } from 'vitest';

import { mapReconcile } from './mapReconcile.accounting';

const line = (over: Partial<ReconcileLineResponse>): ReconcileLineResponse => ({
  line: 'commission',
  title: 'Комиссии',
  document: 'act',
  basis: 'act_days',
  registryKopecks: -20_000,
  manualKopecks: 0,
  operationCount: 2,
  documentKopecks: -5_000,
  differenceKopecks: -15_000,
  status: 'mismatch',
  reason: null,
  candidates: {
    items: [
      {
        operationId: 'op-1',
        source: 'journal',
        reason: 'no_pair',
        orderId: '42',
        article: 'commission',
        subArticle: 'commission',
        amountKopecks: -15_000,
        accruedOn: '2026-09-10',
        actDay: '2026-09-30',
        paidOn: null,
        serviceName: 'Размещение товарных предложений',
        title: 'Размещение товарных предложений',
        matchesDifference: true,
      },
    ],
    count: 1,
  },
  ...over,
});

const RESPONSE: ReconcileResponse = {
  period: { from: '2026-09-01', to: '2026-09-30' },
  marketplace: 'ym',
  marketplaceOptions: [{ marketplace: 'ym', label: 'Яндекс Маркет' }],
  status: 'discrepancies',
  partial: true,
  notes: [],
  reconciledAt: '2026-11-08T08:24:00.000Z',
  dataAsOf: '2026-11-08T06:00:00.000Z',
  lines: [
    line({}),
    line({
      line: 'sales',
      title: 'Продажи',
      document: null,
      basis: 'accrued_in_month',
      registryKopecks: 100_000,
      documentKopecks: null,
      differenceKopecks: null,
      status: 'no_document',
      reason: 'Отчёта о реализации Маркета в сервисе нет — сверить не с чем',
      candidates: { items: [], count: 0 },
    }),
    line({
      line: 'unknown',
      title: 'Не распознано',
      operationCount: 0,
      registryKopecks: 0,
      documentKopecks: null,
      differenceKopecks: null,
      status: 'no_document',
      candidates: { items: [], count: 0 },
    }),
    line({
      line: 'payouts',
      title: 'Выплаты',
      document: 'payment_orders',
      registryKopecks: 92_000,
      documentKopecks: 92_000,
      differenceKopecks: 0,
      status: 'matched',
      candidates: { items: [], count: 0 },
    }),
  ],
  acts: [
    {
      actDay: '2026-09-30',
      registryKopecks: 20_000,
      documentKopecks: 5_000,
      differenceKopecks: 15_000,
      status: 'mismatch',
      unknownSheets: [],
    },
  ],
  paymentOrders: [
    {
      bankOrderId: '823284',
      paidOn: '2026-09-04',
      registryKopecks: 92_000,
      documentKopecks: 92_000,
      differenceKopecks: 0,
      status: 'matched',
      operationCount: 3,
      reason: null,
    },
  ],
  storeLevel: {
    items: [
      {
        operationId: 'm-1',
        source: 'manual',
        article: 'commission',
        subArticle: null,
        amountKopecks: -700,
        accruedOn: '2026-09-15',
        serviceName: null,
        title: 'Комиссия',
      },
    ],
    count: 3,
    totalKopecks: -2_100,
  },
  unmatchedCount: 3,
  candidateCount: 1,
  discrepantOrderIds: ['42'],
};

describe('mapReconcile', () => {
  const view = mapReconcile(RESPONSE, new Date('2026-11-08T09:00:00Z'));

  it('итог: статус, тон, когда сверено и на какие данные', () => {
    expect(view.statusLabel).toBe('Есть расхождения');
    expect(view.tone).toBe('danger');
    expect(view.stampLabel).toMatch(/^Сверено .*данные на /);
    expect(view.unmatchedLabel).toBe('3 операции без заказа');
  });

  it('сверено не всё — перечислены только непустые статьи без документа', () => {
    expect(view.partialNote).toBe('Сверено не всё: без документа — продажи');
  });

  it('статья с расхождением раскрывается до операций', () => {
    const commission = view.lines.find((l) => l.key === 'commission');
    expect(commission).toMatchObject({
      statusLabel: 'Расхождение',
      tone: 'danger',
      candidateCount: 1,
    });
    expect(commission?.candidates[0]).toMatchObject({
      reasonLabel: 'Нет пары в документе',
      orderLabel: 'Заказ 42',
      dayLabel: '10-09-2026',
      documentDayLabel: '30-09-2026',
      matchesDifference: true,
    });
    expect(view.lines.find((l) => l.key === 'sales')).toMatchObject({
      documentLabel: '—',
      statusLabel: 'Нет документа',
      tone: 'outline',
    });
    expect(view.lines.find((l) => l.key === 'payouts')?.summary).toBe(true);
  });

  it('документы — акты и поручения; без заказа — с хвостом «ещё»', () => {
    expect(view.documents.map((d) => d.title)).toEqual([
      'Акт от 30-09-2026',
      'Поручение № 823284 от 04-09-2026',
    ]);
    expect(view.storeLevel[0]).toMatchObject({ dayLabel: '15-09-2026', manual: true });
    expect(view.storeLevelMore).toBe(2);
  });

  it('заголовки и выбор площадки — по ответу: ЯМ, Ozon, WB', () => {
    expect(view).toMatchObject({ title: 'Сверка с Маркетом', documentsTitle: 'Документы Маркета' });
    expect(view.marketplaceOptions).toEqual([{ value: 'ym', label: 'Яндекс Маркет' }]);

    const ozon = mapReconcile({
      ...RESPONSE,
      marketplace: 'ozon',
      marketplaceOptions: [
        { marketplace: 'ym', label: 'Яндекс Маркет' },
        { marketplace: 'ozon', label: 'Ozon' },
      ],
      acts: [],
      paymentOrders: [],
    });
    expect(ozon).toMatchObject({ title: 'Сверка с Ozon', documentsTitle: 'Документы Ozon' });
    expect(ozon.documents).toEqual([]);
    expect(ozon.documentsEmpty).toMatch(/сальдо месяца/);
    expect(ozon.marketplaceOptions.map((o) => o.value)).toEqual(['ym', 'ozon']);

    const wb = mapReconcile({ ...RESPONSE, marketplace: 'wb', acts: [], paymentOrders: [] });
    expect(wb.title).toBe('Сверка с WB');
    expect(wb.documentsEmpty).toBe('Независимых документов WB в сервисе нет.');
  });
});
