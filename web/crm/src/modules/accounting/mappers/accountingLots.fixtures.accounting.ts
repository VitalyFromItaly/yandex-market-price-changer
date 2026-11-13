import type { AccountingLotResponse, CostSettingsResponse } from '../accounting.domain';

export function lotResponse(over: Partial<AccountingLotResponse> = {}): AccountingLotResponse {
  return {
    lotId: 'L1',
    purchaseId: 'P1',
    supplier: 'ООО Восток',
    receivedDay: '2026-10-01',
    sku: 'A1',
    name: 'Часы',
    productMatched: true,
    count: 3,
    remaining: 1,
    unitPriceKopecks: 100_000,
    extraKopecks: 1_000,
    unitCostKopecks: 100_333,
    remainingCostKopecks: 100_333,
    ...over,
  };
}

export function costSettingsResponse(
  over: Partial<CostSettingsResponse> = {},
): CostSettingsResponse {
  return {
    method: 'historical_price',
    methodTitle: 'Закуп из прайса на момент продажи',
    isDefault: true,
    updatedAt: null,
    options: [
      { key: 'historical_price', label: 'Закуп из прайса на момент продажи' },
      { key: 'lot_fifo', label: 'Партии закупок (FIFO)' },
    ],
    ...over,
  };
}
