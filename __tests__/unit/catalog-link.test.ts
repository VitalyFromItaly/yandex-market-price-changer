import { describe, it, expect, vi } from 'vitest';

import { stockPushPlanOf } from '../../src/modules/finance/stock-push';
import { MarketplaceNotConnectedError } from '../../src/modules/marketplaces/marketplace-adapter';
import {
  CatalogLinkService,
  catalogLinkMarketplaces,
} from '../../src/modules/stock-push/catalog-link.service';
import { formatPushPassReport } from '../../src/modules/stock-push/stock-push-report';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { StockSyncProcessor } from '../../src/modules/telegram/queue/processors/stock-sync.processor';
import { catalogLinkText, formatStockReport } from '../../src/modules/yandex/stocks/stock-report';

/**
 * Карточки Ozon/WB находят товары прайса при каждой загрузке (решение
 * `catalog_link_on_price_list`) — как ЯМ по своему каталогу. Без этого
 * «Передаче остатков» писать на Ozon/WB было нечего (прод 406937947).
 */

const MATCH = {
  cards: 471,
  linked: 0,
  matched: { barcode: 0, vendorCode: 0, sku: 471 },
  created: 0,
  issues: { conflict: 0, shared: 0, sku_taken: 0, no_match: 0 },
  skipped: 0,
  boundPercent: 100,
};

function linkService(listProducts: ReturnType<typeof vi.fn>, catalogs = ['ozon', 'wb']) {
  const syncCatalog = vi.fn(async () => ({ match: MATCH, written: { matched: 471 } }));
  const report = vi.fn();
  const registry = {
    capability: vi.fn((mp: string) => (catalogs.includes(mp) ? { listProducts } : null)),
  };
  const service = new CatalogLinkService(
    registry as never,
    { syncCatalog } as never,
    { report } as never,
  );
  return { service, syncCatalog, report, registry };
}

describe('catalogLinkMarketplaces — что сопоставлять при загрузке', () => {
  it('только открытые продавцу площадки; админ — обе', () => {
    expect(catalogLinkMarketplaces({ [FEATURE.OZON]: true })).toEqual(['ozon']);
    expect(catalogLinkMarketplaces({ [FEATURE.OZON]: true, [FEATURE.WB]: true })).toEqual([
      'ozon',
      'wb',
    ]);
    expect(catalogLinkMarketplaces({})).toEqual([]);
    expect(catalogLinkMarketplaces(undefined, true)).toEqual(['ozon', 'wb']);
  });
});

describe('CatalogLinkService', () => {
  it('каталог площадки → syncCatalog, итог — сколько карточек нашли товар', async () => {
    const rows = [{ sku: 'OZ-1' }];
    const listProducts = vi.fn(async () => rows);
    const { service, syncCatalog } = linkService(listProducts);

    expect(await service.link('1', ['ozon'])).toEqual([
      { marketplace: 'ozon', cards: 471, matched: 471 },
    ]);
    expect(listProducts).toHaveBeenCalledWith({ telegramUserId: '1', marketplace: 'ozon' });
    expect(syncCatalog).toHaveBeenCalledWith('1', 'ozon', rows);
  });

  it('не подключена — площадки нет в итоге и без алерта', async () => {
    const listProducts = vi.fn(async () => {
      throw new MarketplaceNotConnectedError('wb', '1', 'no-connection' as never, 'catalog');
    });
    const { service, report } = linkService(listProducts);
    expect(await service.link('1', ['wb'])).toEqual([]);
    expect(report).not.toHaveBeenCalled();
  });

  it('сбой чтения — строка с причиной и алерт, без исключения', async () => {
    const listProducts = vi.fn(async () => {
      throw new Error('timeout');
    });
    const { service, report, syncCatalog } = linkService(listProducts);
    const [link] = await service.link('1', ['ozon']);
    expect(link).toMatchObject({ marketplace: 'ozon', cards: 0, matched: 0 });
    expect(link.error).toBeTruthy();
    expect(syncCatalog).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'ozon', context: 'catalog-link:ozon' }),
    );
  });
});

describe('отчёт о загрузке — строка площадки как «Нашлось совпадений» ЯМ', () => {
  it('бот и CRM пишут одно и то же', () => {
    expect(catalogLinkText({ marketplace: 'wb', cards: 2273, matched: 2271 })).toBe(
      'Wildberries: нашлось совпадений 2271 из 2273 карточек',
    );
    expect(catalogLinkText({ marketplace: 'ozon', cards: 0, matched: 0, error: 'нет ответа' })).toBe(
      'Ozon: карточки не прочитались — нет ответа',
    );
    const text = formatStockReport({
      totalRows: 3,
      matched: 2,
      zeroed: 0,
      updated: 2,
      skipped: [],
      matchedBy: {},
      errors: [],
      dryRun: false,
      catalogSize: 10,
      purchasePricesSaved: 0,
      catalogLinks: [{ marketplace: 'ozon', cards: 471, matched: 471 }],
    });
    expect(text).toContain('Ozon: нашлось совпадений 471 из 471 карточек');
  });
});

describe('план: площадка без найденных товаров не «совпадает»', () => {
  it('linked — товары прайса с артикулом площадки; на отпечаток не влияет', () => {
    const product = {
      id: 'p1',
      internalSku: 'A-1',
      name: 'Часы',
      stock: 3,
      stockDay: '2026-11-02',
      skus: { ym: 'A-1' },
    };
    const ozon = {
      marketplace: 'ozon' as const,
      key: 'ozon:77',
      name: 'Дом',
      placement: 'FBS',
      available: {},
      canWrite: true,
    };
    const input = {
      orders: [],
      targets: [ozon],
      today: '2026-11-02',
      oldestStockDay: '2026-10-05',
    };
    const before = stockPushPlanOf({ ...input, products: [product] });
    expect(before.targets[0]).toMatchObject({ linked: 0, updates: [] });
    const after = stockPushPlanOf({
      ...input,
      products: [{ ...product, skus: { ym: 'A-1', ozon: 'OZ-1' } }],
    });
    expect(after.targets[0].linked).toBe(1);
    expect(after.planHash).toBe(before.planHash);

    const report = formatPushPassReport({ plan: before, writes: [] }, { [FEATURE.STOCK_PUSH]: true, [FEATURE.OZON]: true, [FEATURE.STOCK_PUSH_WRITE_OZON]: true });
    expect(report).toContain('ни один товар прайса не нашёлся');
  });
});

describe('StockSyncProcessor — сопоставление после разбора файла', () => {
  it('CRM: link по списку из задачи, итог — в результате загрузки', async () => {
    const link = vi.fn(async () => [{ marketplace: 'ozon', cards: 471, matched: 471 }]);
    const sync = vi.fn(async () => ({
      totalRows: 1,
      matched: 1,
      zeroed: 0,
      updated: 0,
      skipped: [],
      matchedBy: {},
      errors: [],
      dryRun: false,
      catalogSize: 1,
      purchasePricesSaved: 0,
      stocksByPlan: true,
    }));
    const finishDone = vi.fn(async () => undefined);
    const processor = new StockSyncProcessor(
      {} as never,
      {
        findByTelegramUser: vi.fn(async () => ({
          campaign_id: 'c1',
          business_id: 'b1',
          token: 'ACMA:x',
        })),
      } as never,
      { sync } as never,
      { report: vi.fn() } as never,
      {
        markActive: vi.fn(async () => undefined),
        readInput: vi.fn(async () => ({ buffer: Buffer.from('x') })),
        finishDone,
        finishFailed: vi.fn(async () => undefined),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { link } as never,
    );
    await processor.run({
      data: {
        source: 'crm',
        jobId: 'j1',
        telegramUserId: '1',
        fileName: 'p.xlsx',
        dryRun: false,
        savePurchasePrices: true,
        stockWriteAllowed: true,
        stocksByPlan: true,
        catalogLink: ['ozon'],
      },
    } as never);
    expect(link).toHaveBeenCalledWith('1', ['ozon']);
    expect(finishDone).toHaveBeenCalledWith(
      'j1',
      expect.objectContaining({ catalogLinks: ['Ozon: нашлось совпадений 471 из 471 карточек'] }),
      null,
    );
  });
});
