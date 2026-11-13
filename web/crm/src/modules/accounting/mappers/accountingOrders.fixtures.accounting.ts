import type {
  AccountingOrderCardResponse,
  AccountingOrdersResponse,
  OrderCardAmountResponse,
} from '../accounting.domain';

/** Фикстуры ответов `accounting:orders` / `accounting:order` для спек. */
export function ordersResponse(
  over: Partial<AccountingOrdersResponse> = {},
): AccountingOrdersResponse {
  return {
    period: { from: '2026-10-01', to: '2026-10-31' },
    costMethod: 'Пропорционально выручке',
    marketplaces: ['ym', 'ozon'],
    rows: [
      {
        marketplace: 'ym',
        orderId: '101',
        createdOn: '2026-10-03',
        offerNames: ['Чайник', 'Кружка', 'Ложка'],
        units: 3,
        revenueKopecks: 150_000,
        confirmedKopecks: 20_000,
        expectedKopecks: -5_000,
        netKopecks: 15_000,
        state: 'preliminary',
        stateTitle: 'Предварительно',
        isLoss: false,
      },
      {
        marketplace: 'ozon',
        orderId: '202',
        createdOn: null,
        offerNames: [],
        units: 1,
        revenueKopecks: null,
        confirmedKopecks: 0,
        expectedKopecks: 0,
        netKopecks: null,
        state: 'forecast',
        stateTitle: 'Прогноз',
        isLoss: false,
      },
    ],
    totals: {
      count: 2,
      lossCount: 0,
      confirmedKopecks: 20_000,
      expectedKopecks: -5_000,
      netKopecks: 15_000,
      unknownCount: 1,
    },
    unallocatedKopecks: 0,
    filter: { marketplace: null, state: null, lossOnly: false },
    marketplaceOptions: [
      { marketplace: 'ym', label: 'Яндекс Маркет' },
      { marketplace: 'ozon', label: 'Ozon' },
    ],
    stateOptions: [
      { key: 'forecast', label: 'Прогноз' },
      { key: 'preliminary', label: 'Предварительно' },
      { key: 'reconciled', label: 'Сверено' },
    ],
    ...over,
  };
}

export function amount(over: Partial<OrderCardAmountResponse>): OrderCardAmountResponse {
  return {
    key: 'revenue',
    title: 'Выручка продавца',
    kopecks: 100_000,
    source: 'actual',
    reason: null,
    method: null,
    basis: null,
    note: null,
    operations: [],
    ...over,
  };
}

export function cardResponse(
  over: Partial<AccountingOrderCardResponse> = {},
): AccountingOrderCardResponse {
  return {
    marketplace: 'ym',
    marketplaceLabel: 'Яндекс Маркет',
    orderId: '101',
    createdOn: '2026-10-03',
    state: 'preliminary',
    stateTitle: 'Предварительно',
    stateHint: 'Часть сумм ещё ожидается или месяц не сверен — прибыль не окончательная',
    final: false,
    reconcile: null,
    costMethod: 'Пропорционально выручке',
    cogsMethod: 'historical_price',
    cogsMethodTitle: 'Закуп из прайса на момент продажи',
    allocationPeriod: { from: '2026-10-01', to: '2026-10-31' },
    prices: {
      buyerKopecks: 120_000,
      sellerKopecks: 100_000,
      recognizedKopecks: null,
      marketplaceDiscountKopecks: 20_000,
    },
    amounts: [
      amount({
        operations: [
          {
            id: 'op-1',
            title: 'Оплата заказа',
            kopecks: 100_000,
            accruedOn: '2026-10-05',
            marketplace: 'ym',
            documentId: 'doc-7',
            origin: 'journal',
          },
        ],
      }),
      amount({
        key: 'commission',
        title: 'Комиссия',
        kopecks: -8_000,
        source: 'expected',
        reason: 'forecast',
        basis: 'Оценка по средним ставкам за 30 дней',
      }),
      amount({
        key: 'opex_allocated',
        title: 'Общие расходы (распределено)',
        kopecks: -1_000,
        source: 'allocated',
        method: 'Пропорционально выручке',
        allocationPeriod: { from: '2026-10-01', to: '2026-10-31' },
      }),
      amount({
        key: 'cogs',
        title: 'Себестоимость',
        kopecks: null,
        source: 'unknown',
        reason: 'no-record',
        costLines: [
          {
            itemId: 'i1',
            offerId: 'SKU-1',
            offerName: 'Чайник',
            count: 1,
            unitKopecks: null,
            recordFrom: null,
            reason: 'no-record',
          },
        ],
      }),
    ],
    reference: [],
    confirmedKopecks: 99_000,
    expectedKopecks: -8_000,
    netKopecks: null,
    unknown: { key: 'cogs', reason: 'no-record' },
    lines: [],
    snapshot: { version: 2, written: false, reason: null },
    versions: [
      {
        version: 1,
        state: 'forecast',
        reason: 'first',
        reasonTitle: 'Первый расчёт',
        netKopecks: null,
        capturedAt: '2026-10-04T09:00:00.000Z',
      },
    ],
    ...over,
  };
}
