import type { AccountingReturnsResponse } from '../accounting.domain';

/** Ответ `accounting:returns`: ЯМ с известным итогом, Ozon — с неизвестным списанием. */
export function returnsResponse(): AccountingReturnsResponse {
  return {
    period: { from: '2026-10-01', to: '2026-10-31' },
    marketplaces: [
      {
        marketplace: 'ym',
        label: 'Яндекс Маркет',
        ordersCount: 20,
        returnedCount: 2,
        returnRate: 0.1,
        returnedValueKopecks: 300_000,
        deliveryKopecks: -10_000,
        reverseKopecks: -12_000,
        withheldKopecks: -6_000,
        compensationsKopecks: 2_000,
        writeOffKopecks: 0,
        repackingKopecks: 0,
        resultKopecks: -26_000,
        unknownCount: 0,
      },
      {
        marketplace: 'ozon',
        label: 'Ozon',
        ordersCount: 0,
        returnedCount: 1,
        returnRate: null,
        returnedValueKopecks: null,
        deliveryKopecks: 0,
        reverseKopecks: -7_000,
        withheldKopecks: 0,
        compensationsKopecks: 0,
        writeOffKopecks: null,
        repackingKopecks: -500,
        resultKopecks: null,
        unknownCount: 1,
      },
    ],
    models: [
      {
        marketplace: 'ym',
        label: 'Яндекс Маркет',
        offerId: 'A1',
        offerName: 'Чайник',
        returnedUnits: 2,
        soldUnits: 8,
        returnRate: 0.25,
      },
    ],
    orders: [
      {
        marketplace: 'ym',
        orderId: '100',
        title: 'Чайник',
        returnedOn: '2026-10-20',
        logisticsKopecks: -11_000,
        resultKopecks: -13_000,
      },
      {
        marketplace: 'ozon',
        orderId: 'O-1',
        title: '',
        returnedOn: null,
        logisticsKopecks: -7_000,
        resultKopecks: null,
      },
    ],
  };
}
