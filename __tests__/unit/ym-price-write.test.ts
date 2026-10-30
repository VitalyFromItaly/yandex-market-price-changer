import { describe, it, expect, vi } from 'vitest';

import { ymDiscountBaseFor } from '../../src/modules/marketplaces/price-write';
import { YmPriceWriteService } from '../../src/modules/yandex/prices/ym-price-write.service';

const STORE = { token: 't', campaign_id: '1', business_id: '2' } as never;

function setup(
  options: {
    enabled?: boolean;
    current?: Record<string, { price: number | null; discountBase?: number }>;
  } = {},
) {
  const current = new Map(
    Object.entries(options.current ?? {}).map(([offerId, price]) => [
      offerId,
      { offerId, ...price },
    ]),
  );
  const client = {
    getOfferPrices: vi.fn(async () => current),
    updateOfferPrices: vi.fn(async (): Promise<void> => undefined),
  };
  const clients = { forStore: vi.fn(() => client) };
  const config = { priceWriteEnabled: options.enabled ?? true };
  const service = new YmPriceWriteService(config as never, clients as never);
  return { service, client, clients };
}

describe('YmPriceWriteService', () => {
  it('текущие цены — цена продажи по артикулу, зачёркнутая в план не идёт', async () => {
    const { service, client } = setup({
      current: { A: { price: 1990, discountBase: 2490 }, B: { price: null } },
    });
    const prices = await service.currentPrices(STORE, ['A', 'B', 'C']);

    expect(client.getOfferPrices).toHaveBeenCalledWith(['A', 'B', 'C']);
    expect(prices).toEqual(
      new Map([
        ['A', { price: 1990 }],
        ['B', { price: null }],
      ]),
    );
  });

  it('PRICE_WRITE_ENABLED=false — dry run write-disabled, ни одного запроса', async () => {
    const { service, clients } = setup({ enabled: false });
    const result = await service.writePrices(STORE, [{ sku: 'A', price: 100 }]);

    expect(result).toEqual({ written: 0, errors: [], skipped: [], skipReason: 'write-disabled' });
    expect(clients.forStore).not.toHaveBeenCalled();
  });

  it.each([0, -1, 99.5, Number.NaN])('цена %o отменяет запись целиком до HTTP', async (price) => {
    const { service, clients } = setup();
    await expect(
      service.writePrices(STORE, [
        { sku: 'OK', price: 100 },
        { sku: 'BAD', price },
      ]),
    ).rejects.toThrow('BAD');
    expect(clients.forStore).not.toHaveBeenCalled();
  });

  it('зачёркнутая уходит обратно, пока скидка в окне 5–99%, иначе снимается', async () => {
    const { service, client } = setup({
      current: {
        A: { price: 1990, discountBase: 2490 },
        B: { price: 900, discountBase: 1000 },
        C: { price: 500 },
      },
    });
    const result = await service.writePrices(STORE, [
      { sku: 'A', price: 1800 },
      { sku: 'B', price: 960 },
      { sku: 'C', price: 550 },
    ]);

    expect(result).toEqual({ written: 3, errors: [], skipped: [] });
    expect(client.updateOfferPrices).toHaveBeenCalledWith([
      { offerId: 'A', price: 1800, discountBase: 2490 },
      { offerId: 'B', price: 960, discountBase: undefined },
      { offerId: 'C', price: 550, discountBase: undefined },
    ]);
  });

  it('батчи по 500; упавший батч — в errors, следующие пишутся', async () => {
    const { service, client } = setup();
    client.updateOfferPrices
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Partner API 400'))
      .mockResolvedValueOnce(undefined);
    const updates = Array.from({ length: 1200 }, (_, i) => ({ sku: `S-${i}`, price: 100 }));
    const result = await service.writePrices(STORE, updates);

    expect(client.updateOfferPrices).toHaveBeenCalledTimes(3);
    expect(
      client.updateOfferPrices.mock.calls.map(([batch]) => (batch as unknown[]).length),
    ).toEqual([500, 500, 200]);
    expect(result).toEqual({
      written: 700,
      errors: [{ batch: 2, message: 'Partner API 400' }],
      skipped: [],
    });
  });

  it('пустой список — без запросов', async () => {
    const { service, clients } = setup();
    expect(await service.writePrices(STORE, [])).toEqual({ written: 0, errors: [], skipped: [] });
    expect(clients.forStore).not.toHaveBeenCalled();
  });
});

describe('ymDiscountBaseFor', () => {
  it('держит окно скидки 5–99% от зачёркнутой', () => {
    expect(ymDiscountBaseFor(950, 1000)).toBe(1000); // ровно 5%
    expect(ymDiscountBaseFor(951, 1000)).toBeUndefined(); // меньше 5%
    expect(ymDiscountBaseFor(1200, 1000)).toBeUndefined(); // выше зачёркнутой
    expect(ymDiscountBaseFor(10, 1000)).toBe(1000); // ровно 99%
    expect(ymDiscountBaseFor(9, 1000)).toBeUndefined(); // больше 99%
    expect(ymDiscountBaseFor(500, undefined)).toBeUndefined();
  });
});
