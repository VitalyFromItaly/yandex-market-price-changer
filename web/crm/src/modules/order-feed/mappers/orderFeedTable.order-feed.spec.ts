import type { OrderDetailResponse, OrderFeedRow } from '../order-feed.domain';

import { describe, expect, it } from 'vitest';

import { EMPTY_FILTERS } from '../order-feed.domain';

import { historyRows } from './mapOrderDetail.order-feed';
import {
  expenseArticles,
  filterRows,
  itemsLabel,
  marketplaceOptions,
  profitLabel,
  totalsLines,
} from './orderFeedTable.order-feed';

function row(partial: Partial<OrderFeedRow>): OrderFeedRow {
  return {
    marketplace: 'ym',
    id: '100',
    orderNumber: '100',
    scheme: 'FBS',
    stage: 'redeemed',
    stageLabel: 'Выкуплен',
    status: 'DELIVERED',
    createdDay: '2026-10-01',
    items: [{ sku: 'A1', name: 'Casio A1', count: 2 }],
    sales: 3000,
    operations: 2,
    operationsKopecks: 270_000,
    cogsKopecks: 200_000,
    profitKopecks: 70_000,
    profitGap: null,
    articles: [],
    ...partial,
  };
}

const NBSP = ' ';

describe('таблица «Ленты заказов»', () => {
  const rows = [
    row({ id: '1' }),
    row({ id: '2', marketplace: 'ozon', stage: 'in_transit' }),
    row({ id: '3', items: [{ sku: 'B7', name: null, count: 1 }] }),
  ];

  it('фильтры: площадка, этап, товар по артикулу или названию без регистра', () => {
    expect(filterRows(rows, EMPTY_FILTERS)).toHaveLength(3);
    expect(filterRows(rows, { ...EMPTY_FILTERS, marketplace: 'ozon' }).map((r) => r.id)).toEqual([
      '2',
    ]);
    expect(filterRows(rows, { ...EMPTY_FILTERS, stage: 'redeemed' }).map((r) => r.id)).toEqual([
      '1',
      '3',
    ]);
    expect(filterRows(rows, { ...EMPTY_FILTERS, product: 'casio' }).map((r) => r.id)).toEqual([
      '1',
      '2',
    ]);
    expect(filterRows(rows, { ...EMPTY_FILTERS, product: ' b7 ' }).map((r) => r.id)).toEqual(['3']);
  });

  it('прибыли нет — причина, а не ноль', () => {
    expect(profitLabel(row({}))).toBe(`700${NBSP}₽`);
    expect(profitLabel(row({ profitKopecks: null, profitGap: 'no-operations' }))).toBe(
      'операций в журнале ещё нет',
    );
    expect(profitLabel(row({ profitKopecks: null, profitGap: 'no-cost' }))).toBe(
      'нет закупа товара',
    );
  });

  it('товары строкой, штуки — когда больше одной', () => {
    expect(itemsLabel(row({}))).toBe('Casio A1 × 2');
    expect(itemsLabel(rows[2] as OrderFeedRow)).toBe('B7');
  });

  it('расходы — только статьи расхода, крупные первыми', () => {
    expect(
      expenseArticles([
        { article: 'sales', title: 'Продажи', group: 'income', kopecks: 100 },
        { article: 'commission', title: 'Комиссия', group: 'expense', kopecks: -10 },
        { article: 'delivery_to_buyer', title: 'Логистика', group: 'expense', kopecks: -30 },
      ]).map((a) => a.article),
    ).toEqual(['delivery_to_buyer', 'commission']);
  });

  it('итоги — по строке на площадку со своей подписью, без общего числа', () => {
    const lines = totalsLines([
      {
        marketplace: 'ym',
        label: 'Яндекс Маркет',
        orders: 2,
        withOperations: 1,
        profitKopecks: 70_000,
        profitOrders: 1,
      },
      {
        marketplace: 'ozon',
        label: 'Ozon',
        orders: 1,
        withOperations: 0,
        profitKopecks: 0,
        profitOrders: 0,
      },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^Яндекс Маркет: 2 заказа, прибыль 700/);
    expect(lines[1]).toBe('Ozon: 1 заказ, прибыли пока нет — операций в журнале нет');
  });

  it('варианты площадки — «Все» и только площадки из ответа', () => {
    expect(marketplaceOptions([{ marketplace: 'wb', label: 'Wildberries' }])).toEqual([
      { value: 'all', label: 'Все' },
      { value: 'wb', label: 'Wildberries' },
    ]);
  });

  it('история: статья подписью из ответа, себестоимость — только у строки товара', () => {
    const detail: OrderDetailResponse = {
      marketplace: 'ym',
      orderId: '100',
      operations: 2,
      operationsKopecks: 0,
      cogsKopecks: 0,
      profitKopecks: 0,
      profitGap: null,
      articles: [{ article: 'sales', title: 'Продажи', group: 'income', kopecks: 100 }],
      history: [
        {
          id: 'a',
          accruedDay: '2026-10-05',
          paidDay: null,
          article: 'sales',
          serviceName: null,
          transactionType: 'Начисление',
          amountKopecks: 100,
          cogsKopecks: 50,
        },
      ],
    };
    expect(historyRows(detail)).toEqual([
      {
        key: 'a:sales:0',
        day: '05-10-2026',
        article: 'Продажи',
        service: 'Начисление',
        amount: `1${NBSP}₽`,
        cogs: `0,5${NBSP}₽`,
      },
    ]);
  });
});
