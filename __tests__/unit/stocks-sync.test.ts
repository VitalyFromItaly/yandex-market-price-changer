import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { StockSyncService } from '../../src/modules/yandex/stocks/stock-sync.service';
import { formatStockReport } from '../../src/modules/yandex/stocks/stock-report';
import { STOCKS_BATCH_SIZE } from '../../src/modules/yandex/yandex-api.paths';

const FIXTURE = join(process.cwd(), '__tests__/fixtures/price-template.xlsx');
const CREDENTIALS = { token: 't', campaignId: 'c', businessId: 'b' };

/** Клиент-заглушка: сети не касаемся, но записываем всё, что бы ушло. */
function fakeClient(catalog: string[], opts: { failBatch?: number } = {}) {
  const calls: Array<{ items: Array<{ sku: string; count: number }>; warehouseId: number }> = [];
  let batch = 0;

  return {
    calls,
    loadCatalogOfferIds: vi.fn(async () => new Set(catalog)),
    getWarehouseId: vi.fn(async () => 777),
    updateStocks: vi.fn(async (items: never[], warehouseId: number) => {
      batch += 1;
      if (opts.failBatch === batch) throw new Error('400 Bad Request');
      calls.push({ items, warehouseId });
    }),
  };
}

function serviceWith(client: ReturnType<typeof fakeClient>) {
  return new StockSyncService({ forTenant: () => client } as never);
}

describe('StockSyncService', () => {
  const file = readFileSync(FIXTURE);

  it('сухой прогон НЕ делает ни одной записи', async () => {
    const client = fakeClient(['FAA02006M']);
    const result = await serviceWith(client).sync(CREDENTIALS, file, true);

    expect(client.updateStocks).not.toHaveBeenCalled();
    expect(client.getWarehouseId).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.updated).toBe(0);
    // но сверку провёл
    expect(result.matched).toBe(1);
    expect(result.catalogSize).toBe(1);
  });

  it('позиции не из каталога пропускаются, а не роняют загрузку', async () => {
    const client = fakeClient(['FAA02006M']);
    const result = await serviceWith(client).sync(CREDENTIALS, file, false);

    expect(result.matched).toBe(1);
    expect(result.skipped.length).toBe(result.totalRows - 1);
    expect(result.skipped[0].reason).toBe('нет в каталоге Яндекса');
    expect(result.errors).toHaveLength(0);
  });

  it('в Яндекс уходит артикул из каталога и количество из прайса', async () => {
    const client = fakeClient(['FAA02006M']);
    await serviceWith(client).sync(CREDENTIALS, file, false);

    expect(client.calls[0].items).toEqual([{ sku: 'FAA02006M', count: 2 }]);
    expect(client.calls[0].warehouseId).toBe(777);
  });

  it('порог «>10» доезжает до API как 11, а НЕ как 0', async () => {
    // Регресс на старую логику: она обнулила бы 1605 позиций.
    const client = fakeClient(['GA-2100-1A1']);
    await serviceWith(client).sync(CREDENTIALS, file, false);

    const sent = client.calls.flatMap((c) => c.items);
    expect(sent).toHaveLength(1);
    expect(sent[0].count).toBeGreaterThan(0);
  });

  it('запись бьётся на батчи по STOCKS_BATCH_SIZE', async () => {
    const rows = readFileSync(FIXTURE);
    // Каталог = все артикулы без бренда, чтобы совпало максимум позиций.
    const { parsePriceList } = await import('../../src/modules/yandex/stocks/price-list.parser');
    const { stripBrand } = await import('../../src/modules/yandex/stocks/sku-resolver');
    const all = parsePriceList(rows).rows.map((r) => stripBrand(r.name));

    const client = fakeClient(all);
    const result = await serviceWith(client).sync(CREDENTIALS, rows, false);

    expect(result.updated).toBe(result.matched);
    expect(client.updateStocks).toHaveBeenCalledTimes(
      Math.ceil(result.matched / STOCKS_BATCH_SIZE),
    );
    for (const call of client.calls) {
      expect(call.items.length).toBeLessThanOrEqual(STOCKS_BATCH_SIZE);
    }
  });

  it('отказ одного батча НЕ прерывает остальные', async () => {
    const { parsePriceList } = await import('../../src/modules/yandex/stocks/price-list.parser');
    const { stripBrand } = await import('../../src/modules/yandex/stocks/sku-resolver');
    const all = parsePriceList(file).rows.map((r) => stripBrand(r.name));

    const client = fakeClient(all, { failBatch: 1 });
    const result = await serviceWith(client).sync(CREDENTIALS, file, false);

    // Первый батч упал, но остальные ушли.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].batch).toBe(1);
    expect(result.errors[0].skus).toHaveLength(STOCKS_BATCH_SIZE);
    expect(result.updated).toBe(result.matched - STOCKS_BATCH_SIZE);
    expect(result.updated).toBeGreaterThan(0);
  });

  it('пустой каталог: ничего не пишем и не падаем', async () => {
    const client = fakeClient([]);
    const result = await serviceWith(client).sync(CREDENTIALS, file, false);

    expect(client.updateStocks).not.toHaveBeenCalled();
    expect(result.updated).toBe(0);
    expect(result.skipped.length).toBe(result.totalRows);
  });
});

describe('formatStockReport', () => {
  const base = {
    totalRows: 4349,
    matched: 4106,
    updated: 4106,
    skipped: [],
    matchedBy: { 'без бренда': 3859, 'приставка «Наручные часы»': 246, 'как в прайсе': 1 },
    errors: [],
    dryRun: false,
    catalogSize: 5599,
  };

  it('успешная загрузка: числа на месте', () => {
    const text = formatStockReport(base);
    expect(text).toContain('Остатки обновлены');
    expect(text).toContain('4349');
    expect(text).toContain('4106');
  });

  it('сухой прогон явно сообщает, что записи не было', () => {
    const text = formatStockReport({ ...base, dryRun: true, updated: 0 });
    expect(text).toContain('ничего не записано');
    expect(text).not.toContain('Остатки обновлены');
  });

  it('пропуски видны ЧИСЛОМ, а не теряются молча', () => {
    const skipped = Array.from({ length: 243 }, (_, i) => ({
      name: `Товар ${i}`,
      category: 'Восток',
      rowNumber: i + 9,
      reason: 'нет в каталоге Яндекса',
    }));
    const text = formatStockReport({ ...base, skipped });

    expect(text).toContain('243');
    expect(text).toContain('и ещё 233'); // перечислено 10, остальные счётчиком
  });

  it('ошибки батчей показывают, сколько позиций не записалось', () => {
    const text = formatStockReport({
      ...base,
      errors: [{ batch: 1, skus: ['a', 'b', 'c'], message: '400 Bad Request' }],
    });
    expect(text).toContain('Не записано из-за ошибок');
    expect(text).toContain('остались со старым остатком');
  });

  it('данные экранируются — иначе имя с < сломает разметку', () => {
    const text = formatStockReport({
      ...base,
      skipped: [
        { name: 'Часы <Casio> & Co', category: 'x', rowNumber: 9, reason: 'нет в каталоге' },
      ],
    });
    expect(text).toContain('&lt;Casio&gt;');
    expect(text).toContain('&amp;');
  });
});
