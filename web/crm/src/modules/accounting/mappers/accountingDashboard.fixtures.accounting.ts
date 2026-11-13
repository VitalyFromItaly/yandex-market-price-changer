import type {
  AccountingAnalyticsResponse,
  AccountingDashboardDrillResponse,
  AccountingDashboardResponse,
  DashboardBlockResponse,
  DashboardLine,
  DashboardLineTotalResponse,
} from '../accounting.domain';

const LINES: [DashboardLine, string][] = [
  ['revenue', 'Выручка'],
  ['returns', 'Возвраты'],
  ['compensations', 'Компенсации и прочие доходы'],
  ['cogs', 'Себестоимость'],
  ['commission', 'Комиссии'],
  ['logistics', 'Логистика'],
  ['marketplace_services', 'Прочие услуги площадки'],
  ['advertising', 'Реклама'],
  ['tax', 'Налоги'],
  ['opex', 'Операционные расходы'],
];

function lines(over: Partial<Record<DashboardLine, Partial<DashboardLineTotalResponse>>> = {}) {
  return LINES.map(([line, title]) => ({
    line,
    title,
    kopecks: 0,
    expectedKopecks: 0,
    count: 0,
    unknownReason: null,
    ...over[line],
  }));
}

function block(over: Partial<DashboardBlockResponse>): DashboardBlockResponse {
  return {
    marketplace: 'ym',
    label: 'Яндекс Маркет',
    lines: lines(),
    grossKopecks: 0,
    netKopecks: 0,
    marginPercent: null,
    payableKopecks: 0,
    receivedKopecks: 0,
    excludesAccountLevel: false,
    ...over,
  };
}

/** Панель: ЯМ — факт с ожидаемой комиссией, Ozon — с неизвестной себестоимостью, «Все площадки» от сервера. */
export function dashboardResponse(): AccountingDashboardResponse {
  return {
    basis: 'sale',
    basisTitle: 'По дате продажи',
    basisHint: 'Заказы, оформленные в периоде, целиком.',
    period: { from: '2026-11-01', to: '2026-11-10' },
    periodEcho: { key: null, day: null, range: { from: '2026-11-01', to: '2026-11-10' } },
    filter: { marketplace: null, brand: null, offerId: null, orderId: null },
    marketplaces: ['ym', 'ozon'],
    totals: {
      byMarketplace: [
        block({
          lines: lines({
            revenue: { kopecks: 1_000_000, count: 10 },
            commission: { kopecks: -150_000, expectedKopecks: -20_000, count: 10 },
          }),
          grossKopecks: 700_000,
          netKopecks: 550_000,
          marginPercent: 55,
          payableKopecks: 300_000,
          receivedKopecks: 200_000,
          excludesAccountLevel: true,
        }),
        block({
          marketplace: 'ozon',
          label: 'Ozon',
          lines: lines({
            revenue: { kopecks: 500_000, count: 3 },
            cogs: { kopecks: null, count: 3, unknownReason: 'no-record' },
          }),
          grossKopecks: null,
          netKopecks: null,
          marginPercent: null,
          payableKopecks: null,
          receivedKopecks: 0,
          excludesAccountLevel: true,
        }),
      ],
      all: block({
        marketplace: null,
        label: 'Все площадки',
        lines: lines({
          revenue: { kopecks: 1_500_000, count: 13 },
          cogs: { kopecks: null, count: 3 },
        }),
        grossKopecks: null,
        netKopecks: null,
      }),
    },
    payableAsOf: '2026-11-11',
    filterNote: null,
    sync: {
      asOf: '2026-11-10T07:00:00.000Z',
      marketplaces: [
        { marketplace: 'ym', label: 'Яндекс Маркет', lastSuccessAt: '2026-11-10T07:00:00.000Z' },
        { marketplace: 'ozon', label: 'Ozon', lastSuccessAt: null },
      ],
    },
    basisOptions: [
      { key: 'sale', label: 'По дате продажи' },
      { key: 'accrual', label: 'По дате начисления' },
      { key: 'cash', label: 'По движению денег' },
    ],
    marketplaceOptions: [
      { marketplace: 'ym', label: 'Яндекс Маркет' },
      { marketplace: 'ozon', label: 'Ozon' },
    ],
    brandOptions: [{ key: 'polza', label: 'Польза' }],
  };
}

export function drillResponse(): AccountingDashboardDrillResponse {
  return {
    basis: 'sale',
    basisTitle: 'По дате продажи',
    period: { from: '2026-11-01', to: '2026-11-10' },
    periodEcho: { key: null, day: null, range: { from: '2026-11-01', to: '2026-11-10' } },
    line: 'commission',
    title: 'Комиссии',
    marketplace: 'ym',
    label: 'Яндекс Маркет',
    kopecks: -150_000,
    operations: [
      {
        id: 'op1',
        title: 'Размещение товара',
        kopecks: -130_000,
        accruedOn: '2026-11-03',
        marketplace: 'ym',
        documentId: 'D-1',
        origin: 'journal',
      },
    ],
    operationsTotal: 600,
    orders: [
      {
        marketplace: 'ym',
        orderId: '111',
        title: 'Чайник',
        kopecks: -20_000,
        expected: true,
        reason: null,
      },
    ],
    ordersTotal: 1,
    records: [],
  };
}

/** Аналитика: ЯМ с данными (день с неизвестной прибылью), Ozon — не подключён. */
export function analyticsResponse(): AccountingAnalyticsResponse {
  return {
    period: { from: '2026-11-01', to: '2026-11-02' },
    periodEcho: { key: null, day: null, range: { from: '2026-11-01', to: '2026-11-02' } },
    products: {
      mostProfitable: [
        {
          marketplace: 'ym',
          label: 'Яндекс Маркет',
          offerId: 'A-1',
          offerName: 'Чайник',
          ordersCount: 2,
          units: 3,
          profitKopecks: 40_000,
          unknownCount: 0,
        },
      ],
      leastProfitable: [],
      unknownModels: 1,
      multiModelOrders: 2,
    },
    lossOrders: {
      orders: [
        {
          marketplace: 'ym',
          label: 'Яндекс Маркет',
          orderId: '222',
          title: 'Утюг',
          createdOn: '2026-11-02',
          resultKopecks: -5_000,
        },
      ],
      total: 3,
    },
    returnModels: { models: [], multiModelReturns: 1 },
    marketplaces: [
      {
        marketplace: 'ym',
        label: 'Яндекс Маркет',
        insufficientData: false,
        ordersCount: 5,
        revenueKopecks: 500_000,
        profitKopecks: null,
        unknownCount: 2,
        margin: null,
        commission: { ordersCount: 4, avgKopecks: -12_000, shareOfRevenue: -0.12 },
        logistics: { ordersCount: 0, avgKopecks: null, shareOfRevenue: null },
      },
      {
        marketplace: 'ozon',
        label: 'Ozon',
        insufficientData: true,
        reason: 'Площадка не подключена или закрыта администратором — данных для сравнения нет.',
      },
    ],
    days: [
      {
        day: '2026-11-01',
        marketplace: 'ym',
        ordersCount: 3,
        profitKopecks: 30_000,
        unknownCount: 0,
      },
      {
        day: '2026-11-02',
        marketplace: 'ym',
        ordersCount: 2,
        profitKopecks: null,
        unknownCount: 2,
      },
    ],
  };
}
