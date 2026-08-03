import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { StockSyncService } from '../../src/modules/yandex/stocks/stock-sync.service';
import { formatStockReport } from '../../src/modules/yandex/stocks/stock-report';
import { STOCKS_BATCH_SIZE } from '../../src/modules/yandex/yandex-api.paths';

const FIXTURE = join(process.cwd(), '__tests__/fixtures/price-template.xlsx');
const CREDENTIALS = { token: 't', campaignId: 'c', businessId: 'b' };
const USER = '42';

/** Хранилище закупа — заглушка, запоминающая то, что бы записалось. */
function fakePurchasePrices() {
  const saved: Array<{ user: string; rows: Array<{ sku: string; price: number }> }> = [];

  return {
    saved,
    upsertMany: vi.fn(async (user: string, rows: Array<{ sku: string; price: number }>) => {
      saved.push({ user, rows });
      return rows.length;
    }),
  };
}

/**
 * Клиент-заглушка: сети не касаемся, но записываем всё, что бы ушло.
 *
 * `listStores` отдаёт FBS по умолчанию — это модель, при которой запись
 * разрешена, то есть прежнее поведение всех тестов ниже. Модель размещения
 * сервис выясняет сам (см. правило в placement.ts), поэтому заглушка обязана
 * уметь на этот вопрос отвечать.
 */
function fakeClient(
  catalog: string[],
  opts: { failBatch?: number; placementType?: string; listStoresFails?: boolean } = {},
) {
  const calls: Array<{ items: Array<{ sku: string; count: number }>; warehouseId: number }> = [];
  let batch = 0;

  return {
    calls,
    listStores: vi.fn(async () => {
      if (opts.listStoresFails) throw new Error('ECONNRESET');
      return [
        // Чужая кампания в списке — рядом намеренно: модель обязана искаться по
        // campaignId, а не браться первой.
        { campaignId: 'другая', businessId: 'b', placementType: 'FBY' },
        {
          campaignId: CREDENTIALS.campaignId,
          businessId: 'b',
          placementType: opts.placementType ?? 'FBS',
        },
      ];
    }),
    loadCatalogOfferIds: vi.fn(async () => new Set(catalog)),
    getWarehouseId: vi.fn(async () => 777),
    updateStocks: vi.fn(async (items: never[], warehouseId: number) => {
      batch += 1;
      if (opts.failBatch === batch) throw new Error('400 Bad Request');
      calls.push({ items, warehouseId });
    }),
  };
}

/**
 * Сервис со ВКЛЮЧЁННОЙ записью по умолчанию.
 *
 * При `STOCK_WRITE_ENABLED=false` запись запрещена целиком (см. describe ниже),
 * поэтому все тесты про саму загрузку идут с `stockWriteEnabled: true` — иначе
 * они проверяли бы не запись, а запрет.
 */
function serviceWith(
  client: ReturnType<typeof fakeClient>,
  prices: ReturnType<typeof fakePurchasePrices> = fakePurchasePrices(),
  stockWriteEnabled = true,
) {
  return new StockSyncService(
    { forTenant: () => client } as never,
    prices as never,
    { stockWriteEnabled } as never,
  );
}

describe('StockSyncService', () => {
  const file = readFileSync(FIXTURE);

  it('сухой прогон НЕ делает ни одной записи', async () => {
    const client = fakeClient(['FAA02006M']);
    const result = await serviceWith(client).sync(CREDENTIALS, file, {
      dryRun: true,
      telegramUserId: USER,
    });

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
    const result = await serviceWith(client).sync(CREDENTIALS, file, { telegramUserId: USER });

    expect(result.matched).toBe(1);
    expect(result.skipped.length).toBe(result.totalRows - 1);
    expect(result.skipped[0].reason).toBe('нет в каталоге Яндекса');
    expect(result.errors).toHaveLength(0);
  });

  it('в Яндекс уходит артикул из каталога и количество из прайса', async () => {
    const client = fakeClient(['FAA02006M']);
    await serviceWith(client).sync(CREDENTIALS, file, { telegramUserId: USER });

    expect(client.calls[0].items).toEqual([{ sku: 'FAA02006M', count: 2 }]);
    expect(client.calls[0].warehouseId).toBe(777);
  });

  it('порог «>10» доезжает до API как 11, а НЕ как 0', async () => {
    // Регресс на старую логику: она обнулила бы 1605 позиций.
    const client = fakeClient(['GA-2100-1A1']);
    await serviceWith(client).sync(CREDENTIALS, file, { telegramUserId: USER });

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
    const result = await serviceWith(client).sync(CREDENTIALS, rows, { telegramUserId: USER });

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
    const result = await serviceWith(client).sync(CREDENTIALS, file, { telegramUserId: USER });

    // Первый батч упал, но остальные ушли.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].batch).toBe(1);
    expect(result.errors[0].skus).toHaveLength(STOCKS_BATCH_SIZE);
    expect(result.updated).toBe(result.matched - STOCKS_BATCH_SIZE);
    expect(result.updated).toBeGreaterThan(0);
  });

  it('пустой каталог: ничего не пишем и не падаем', async () => {
    const client = fakeClient([]);
    const result = await serviceWith(client).sync(CREDENTIALS, file, { telegramUserId: USER });

    expect(client.updateStocks).not.toHaveBeenCalled();
    expect(result.updated).toBe(0);
    expect(result.skipped.length).toBe(result.totalRows);
  });

  it('без telegramUserId падает сразу: закуп ушёл бы в никуда', async () => {
    const client = fakeClient(['FAA02006M']);

    // Именно так выглядел бы забытый переход со старого флага dryRun:
    // sync(creds, file, true) → боевая запись остатков вместо сверки.
    await expect(serviceWith(client).sync(CREDENTIALS, file, true as never)).rejects.toThrow(
      /telegramUserId/,
    );
    expect(client.updateStocks).not.toHaveBeenCalled();
  });
});

/**
 * Правило «на FBY остатки только читаются» — со стороны сервиса.
 *
 * Сама таблица моделей проверена в stocks-placement.test.ts; здесь важно другое:
 * что сервис её СПРАШИВАЕТ и что запрет доходит до места записи. Ровно это и
 * ломается при рефакторинге — правило остаётся верным, а вызывать его перестают.
 */
describe('StockSyncService: запрет записи на FBY', () => {
  const file = readFileSync(FIXTURE);

  it('на FBY не пишет остатки и даже не спрашивает склад', async () => {
    const client = fakeClient(['FAA02006M'], { placementType: 'FBY' });
    const result = await serviceWith(client).sync(CREDENTIALS, file, { telegramUserId: USER });

    expect(client.updateStocks).not.toHaveBeenCalled();
    // getWarehouseId на FBY-кампании вернул бы склад МАРКЕТА (147
    // «Ростов-на-Дону-1» у живого продавца) — узнавать его незачем.
    expect(client.getWarehouseId).not.toHaveBeenCalled();
    expect(result.writeSkipReason).toBe('placement');
    expect(result.placementType).toBe('FBY');
    expect(result.updated).toBe(0);
  });

  it('но закуп на FBY сохраняется — иначе «Прибыль» у такого продавца не считалась бы', async () => {
    const client = fakeClient(['FAA02006M'], { placementType: 'FBY' });
    const prices = fakePurchasePrices();
    const result = await serviceWith(client, prices).sync(CREDENTIALS, file, {
      telegramUserId: USER,
    });

    expect(prices.upsertMany).toHaveBeenCalledTimes(1);
    expect(result.purchasePricesSaved).toBeGreaterThan(0);
    // Файл разобран целиком: отказ касается только записи в Яндекс.
    expect(result.matched).toBeGreaterThan(0);
  });

  it('запрет — это НЕ dryRun: поводы разные, и отчёт обязан их различать', async () => {
    const client = fakeClient(['FAA02006M'], { placementType: 'FBY' });
    const result = await serviceWith(client).sync(CREDENTIALS, file, { telegramUserId: USER });

    expect(result.dryRun).toBe(false);
    expect(result.writeSkipReason).toBe('placement');
  });

  it('модель определяется по campaignId, а не по первой в списке', async () => {
    // В заглушке первой идёт чужая FBY-кампания; наша — FBS.
    const client = fakeClient(['FAA02006M'], { placementType: 'FBS' });
    const result = await serviceWith(client).sync(CREDENTIALS, file, { telegramUserId: USER });

    expect(result.placementType).toBe('FBS');
    expect(result.writeSkipReason).toBeUndefined();
    expect(client.updateStocks).toHaveBeenCalled();
  });

  it('не смогли определить модель — не пишем', async () => {
    // Отказ определить модель не должен превращаться в разрешение писать.
    const client = fakeClient(['FAA02006M'], { listStoresFails: true });
    const result = await serviceWith(client).sync(CREDENTIALS, file, { telegramUserId: USER });

    expect(client.updateStocks).not.toHaveBeenCalled();
    expect(result.writeSkipReason).toBe('placement');
    expect(result.placementType).toBeUndefined();
    // И не роняет загрузку: файл разобран, закуп сохранён.
    expect(result.matched).toBeGreaterThan(0);
  });

  it('отчёт объясняет причину и ведёт к смене магазина', async () => {
    const client = fakeClient(['FAA02006M'], { placementType: 'FBY' });
    const result = await serviceWith(client).sync(CREDENTIALS, file, { telegramUserId: USER });
    const text = formatStockReport(result);

    expect(text).toContain('FBY');
    expect(text).toContain('Сменить магазин');
    // «Записано: 0» выглядит как неудачная запись, тогда как записи не было и
    // быть не должно.
    expect(text).not.toContain('Записано');
    expect(text).not.toContain('Остатки обновлены');
  });

  it('при неизвестной модели отчёт не приписывает магазину FBY', async () => {
    const client = fakeClient(['FAA02006M'], { listStoresFails: true });
    const result = await serviceWith(client).sync(CREDENTIALS, file, { telegramUserId: USER });
    const text = formatStockReport(result);

    expect(text).toContain('Не удалось определить модель');
    expect(text).not.toContain('FBY');
  });
});

/**
 * Запрет записи остатков вне прода.
 *
 * Разработка идёт против БОЕВОГО магазина: токен в `.env` настоящий, и локальный
 * запуск с присланным прайсом менял бы остатки живого продавца. Откатить это
 * нечем — Яндекс не сообщает, что именно применилось. Поэтому ограничение живёт
 * в коде, а не в дисциплине разработчика, и проверяется тестом.
 */
describe('StockSyncService: запись выключена настройкой среды', () => {
  const file = readFileSync(FIXTURE);
  const localService = (
    client: ReturnType<typeof fakeClient>,
    prices?: ReturnType<typeof fakePurchasePrices>,
  ) => serviceWith(client, prices, false);

  it('вне прода остатки не отправляются, даже на пишущей модели', async () => {
    const client = fakeClient(['FAA02006M'], { placementType: 'FBS' });
    const result = await localService(client).sync(CREDENTIALS, file, { telegramUserId: USER });

    expect(client.updateStocks).not.toHaveBeenCalled();
    expect(client.getWarehouseId).not.toHaveBeenCalled();
    expect(result.writeSkipReason).toBe('write-disabled');
    expect(result.updated).toBe(0);
  });

  it('модель у Маркета даже не спрашивается — писать всё равно не будем', async () => {
    const client = fakeClient(['FAA02006M']);
    const result = await localService(client).sync(CREDENTIALS, file, { telegramUserId: USER });

    expect(client.listStores).not.toHaveBeenCalled();
    expect(result.placementType).toBeUndefined();
  });

  it('среда важнее модели: на FBY повод всё равно «локальная среда»', async () => {
    // Иначе отчёт посоветовал бы сменить магазин там, где дело вообще не в нём.
    const client = fakeClient(['FAA02006M'], { placementType: 'FBY' });
    const result = await localService(client).sync(CREDENTIALS, file, { telegramUserId: USER });

    expect(result.writeSkipReason).toBe('write-disabled');
  });

  it('закупочные цены при этом сохраняются — ради «Прибыли»', async () => {
    const prices = fakePurchasePrices();
    const result = await localService(fakeClient(['FAA02006M']), prices).sync(CREDENTIALS, file, {
      telegramUserId: USER,
    });

    expect(prices.upsertMany).toHaveBeenCalledTimes(1);
    expect(result.purchasePricesSaved).toBeGreaterThan(0);
    expect(result.matched).toBeGreaterThan(0);
  });

  it('отчёт называет локальный запуск и НЕ советует продавцу ничего', async () => {
    const result = await localService(fakeClient(['FAA02006M'])).sync(CREDENTIALS, file, {
      telegramUserId: USER,
    });
    const text = formatStockReport(result);

    expect(text).toContain('Запись остатков выключена');
    expect(text).toContain('STOCK_WRITE_ENABLED');
    // Совет «переключитесь на FBS» здесь увёл бы не туда: дело не в магазине.
    expect(text).not.toContain('Сменить магазин');
    expect(text).not.toContain('Остатки обновлены');
  });

  it('в проде поведение прежнее — запись идёт', async () => {
    // Парный кейс: без него тест выше проходил бы и у сломанной записи вообще.
    const client = fakeClient(['FAA02006M'], { placementType: 'FBS' });
    const result = await serviceWith(client).sync(CREDENTIALS, file, { telegramUserId: USER });

    expect(client.updateStocks).toHaveBeenCalled();
    expect(result.writeSkipReason).toBeUndefined();
    expect(result.updated).toBe(1);
  });
});

describe('StockSyncService: закупочные цены', () => {
  const file = readFileSync(FIXTURE);

  it('цена из прайса сохраняется под артикулом КАТАЛОГА, а не под наименованием', async () => {
    const client = fakeClient(['FAA02006M']);
    const prices = fakePurchasePrices();
    const result = await serviceWith(client, prices).sync(CREDENTIALS, file, {
      telegramUserId: USER,
    });

    expect(prices.upsertMany).toHaveBeenCalledTimes(1);
    expect(prices.saved[0].user).toBe(USER);
    // Ключ — «FAA02006M», а не «ORIENT FAA02006M»: в позиции заказа приходит
    // артикул каталога, и join возможен только по нему.
    expect(prices.saved[0].rows).toContainEqual(
      expect.objectContaining({ sku: 'FAA02006M', price: 18800 }),
    );
    // Ни один ключ не сохранён вместе с брендом — ни для найденных в каталоге,
    // ни для остальных.
    expect(prices.saved[0].rows.filter((row) => row.sku.startsWith('ORIENT '))).toEqual([]);
    expect(result.purchasePricesSaved).toBeGreaterThan(1);
  });

  it('СУХОЙ ПРОГОН тоже сохраняет закуп — это наша база, а не Яндекс', async () => {
    const client = fakeClient(['FAA02006M']);
    const prices = fakePurchasePrices();
    const result = await serviceWith(client, prices).sync(CREDENTIALS, file, {
      dryRun: true,
      telegramUserId: USER,
    });

    expect(client.updateStocks).not.toHaveBeenCalled();
    expect(prices.upsertMany).toHaveBeenCalledTimes(1);
    // Цены записаны по ВСЕМ строкам файла, а не только по найденным в каталоге:
    // это наша база, и заказ на позицию вне каталога тоже нужно уметь посчитать.
    expect(result.purchasePricesSaved).toBe(result.totalRows);
  });

  it('позиции ВНЕ каталога сохраняют закуп, но остаток им не пишется', async () => {
    // Раньше такая строка выпадала целиком, и это стоило цен: за июль 6 из 7
    // артикулов без закупа лежали в присланном прайсе с ценой, но их не было в
    // каталоге — продавец из каталога их убрал, а заказы остались. Отчёт при
    // этом просил «пришлите прайс с этими позициями», хотя они в прайсе были.
    const client = fakeClient(['FAA02006M']);
    const prices = fakePurchasePrices();
    const result = await serviceWith(client, prices).sync(CREDENTIALS, file, {
      telegramUserId: USER,
    });

    // Остаток ушёл ровно по одной позиции — той, что есть в каталоге.
    expect(result.matched).toBe(1);
    expect(client.calls[0].items).toEqual([{ sku: 'FAA02006M', count: 2 }]);

    // А закуп — по всем строкам с ценой, под кодом без бренда: именно он
    // приходит в позиции заказа.
    expect(prices.saved[0].rows).toHaveLength(result.totalRows);
    expect(prices.saved[0].rows).toContainEqual(
      expect.objectContaining({ sku: 'FAA02007B', price: 17200 }),
    );
    expect(result.totalRows).toBeGreaterThan(1000);
  });

  it('строка с порогом «>10» сохраняет цену: остаток и закуп независимы', async () => {
    const client = fakeClient(['GA-2100-1A1']);
    const prices = fakePurchasePrices();
    await serviceWith(client, prices).sync(CREDENTIALS, file, { telegramUserId: USER });

    const row = prices.saved[0].rows.find((saved) => saved.sku === 'GA-2100-1A1');
    expect(row?.price).toBeGreaterThan(0);
    // Ни одной цены с нулём или мусором: цена и остаток разбираются независимо.
    expect(prices.saved[0].rows.every((saved) => saved.price > 0)).toBe(true);
  });

  it('сбой записи закупа НЕ роняет обновление остатков', async () => {
    const client = fakeClient(['FAA02006M']);
    const prices = fakePurchasePrices();
    prices.upsertMany.mockRejectedValueOnce(new Error('mongo недоступна'));

    const result = await serviceWith(client, prices).sync(CREDENTIALS, file, {
      telegramUserId: USER,
    });

    // Остатки — то, ради чего файл присылают: они обновились.
    expect(result.updated).toBe(1);
    expect(result.purchasePricesSaved).toBe(0);
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
    purchasePricesSaved: 4106,
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

  it('сохранённый закуп виден числом — иначе «ничего не записано» вводит в заблуждение', () => {
    const text = formatStockReport({ ...base, dryRun: true, updated: 0 });
    expect(text).toContain('Закупочных цен сохранено');
    expect(text).toContain('4106');
  });

  it('без сохранённых цен строки о закупе нет', () => {
    const text = formatStockReport({ ...base, purchasePricesSaved: 0 });
    expect(text).not.toContain('Закупочных цен');
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
