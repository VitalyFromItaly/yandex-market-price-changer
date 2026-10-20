import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { CostHistory } from '../../src/database/schemas/cost-history.schema';
import {
  ProductCardIssue,
  ProductCardIssueSchema,
} from '../../src/database/schemas/product-card-issue.schema';
import { Product } from '../../src/database/schemas/product.schema';
import { ActionLogService } from '../../src/database/services/action-log.service';
import { CostHistoryService } from '../../src/database/services/cost-history.service';
import { ProductCardIssueService } from '../../src/database/services/product-card-issue.service';
import { ProductService } from '../../src/database/services/product.service';
import { AdminAuthService } from '../../src/modules/admin/admin-auth.service';
import { AdminJwtGuard } from '../../src/modules/admin/admin-jwt.guard';
import {
  PRODUCT_LINK_KIND,
  ProductAdminController,
} from '../../src/modules/products/product-admin.controller';
import { ProductMatchService } from '../../src/modules/products/product-match.service';
import { inMemoryModel, type IInMemoryModel } from '../helpers/in-memory-model';

const USER = '111';

/** Строка каталога ЯМ, как её отдаёт productRowsFromCatalog. */
const row = (sku: string, extra: Record<string, unknown> = {}) => ({ sku, barcodes: [], ...extra });

describe('ProductCardIssue: схема', () => {
  it('одна строка очереди на карточку площадки', () => {
    const unique = ProductCardIssueSchema.indexes().find(([, options]) => options?.unique);
    expect(unique?.[0]).toEqual({ telegramUserId: 1, marketplace: 1, sku: 1 });
  });
});

describe('ProductMatchService + ProductAdminController', () => {
  let products: IInMemoryModel;
  let issues: IInMemoryModel;
  let history: IInMemoryModel;
  let productService: ProductService;
  let costHistory: CostHistoryService;
  let matching: ProductMatchService;
  let controller: ProductAdminController;
  let record: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    products = inMemoryModel();
    issues = inMemoryModel();
    history = inMemoryModel();
    // Mongo держит это unique-индексом; в памяти — явно.
    products.uniqueBy('telegramUserId', 'marketplaceSkus.ym');
    issues.uniqueBy('telegramUserId', 'marketplace', 'sku');
    record = vi.fn(async () => undefined);

    const moduleRef = await Test.createTestingModule({
      controllers: [ProductAdminController],
      providers: [
        ProductService,
        ProductCardIssueService,
        ProductMatchService,
        CostHistoryService,
        { provide: getModelToken(Product.name), useValue: products },
        { provide: getModelToken(ProductCardIssue.name), useValue: issues },
        { provide: getModelToken(CostHistory.name), useValue: history },
        { provide: ActionLogService, useValue: { record } },
        { provide: AdminAuthService, useValue: { verify: async () => '1' } },
      ],
    }).compile();

    productService = moduleRef.get(ProductService);
    costHistory = moduleRef.get(CostHistoryService);
    matching = moduleRef.get(ProductMatchService);
    controller = moduleRef.get(ProductAdminController);
  });

  const productBy = (internalSku: string) =>
    products.documents.find((d) => d.internalSku === internalSku);
  const idBy = (internalSku: string) => String(productBy(internalSku)?._id);

  it('товар без привязки находится по штрихкоду и получает карточку с источником', async () => {
    await productService.upsertFromCatalog(USER, [row('OLD', { barcodes: ['111'] })]);
    await productService.clearLink(USER, idBy('OLD'), 'ym');

    const result = await matching.syncYmCatalog(USER, [row('NEW', { barcodes: ['111'] })]);

    expect(result.match.matched.barcode).toBe(1);
    expect(products.documents).toHaveLength(1);
    expect(productBy('OLD')).toMatchObject({
      marketplaceSkus: { ym: 'NEW' },
      marketplaceLinks: { ym: { source: 'barcode' } },
    });
  });

  it('конфликт — в очередь; повторный проход заменяет находки, а не копит', async () => {
    await productService.upsertFromCatalog(USER, [row('P1'), row('P2')]);
    for (const sku of ['P1', 'P2']) {
      await productService.clearLink(USER, idBy(sku), 'ym');
      Object.assign(productBy(sku), { barcodes: ['111'] });
    }

    await matching.syncYmCatalog(USER, [row('C1', { barcodes: ['111'] })]);
    await matching.syncYmCatalog(USER, [row('C1', { barcodes: ['111'] })]);

    expect(issues.documents).toHaveLength(1);
    expect(issues.documents[0]).toMatchObject({
      sku: 'C1',
      reason: 'conflict',
      level: 'barcode',
      candidateIds: [idBy('P1'), idBy('P2')].sort(),
    });

    const page = await controller.unmatched(USER, 'ym');
    expect(page.items[0]).toMatchObject({
      reasonText: 'несколько товаров-кандидатов',
      levelText: 'штрихкод',
    });
    expect(page.items[0].candidates.map((c) => c.internalSku).sort()).toEqual(['P1', 'P2']);
  });

  it('ручная привязка переживает следующий автоматический проход', async () => {
    // A1 и B1 — товары каталога; B1 руками привязан к карточке A1-ALT.
    await productService.upsertFromCatalog(USER, [row('A1'), row('B1', { barcodes: ['999'] })]);
    await productService.clearLink(USER, idBy('B1'), 'ym');
    await controller.link(
      idBy('B1'),
      { telegramUserId: USER, marketplace: 'ym', sku: 'A1-ALT' },
      { adminId: '42' },
    );

    // В каталоге есть и карточка B1 — с тем же штрихкодом, что у товара B1.
    await matching.syncYmCatalog(USER, [
      row('A1'),
      row('A1-ALT'),
      row('B1', { barcodes: ['999'] }),
    ]);

    expect(productBy('B1')).toMatchObject({
      marketplaceSkus: { ym: 'A1-ALT' },
      marketplaceLinks: { ym: { source: 'manual' } },
    });
    // Карточка B1 не увела ручной товар: его internalSku занят — в очередь.
    expect(issues.documents.map((d) => [d.sku, d.reason])).toEqual([['B1', 'sku_taken']]);
  });

  it('ручная отвязка: автомат карточку не возвращает, привязка руками снимает её из очереди', async () => {
    await productService.upsertFromCatalog(USER, [row('A1', { barcodes: ['111'] })]);
    const id = idBy('A1');

    await controller.unlink(id, 'ym', USER, { adminId: '42' });
    expect(productBy('A1').marketplaceSkus).toEqual({});
    expect(issues.documents[0]).toMatchObject({ sku: 'A1', reason: 'manual_unlink' });

    // Пара очевидна (тот же штрихкод), но проход карточку пропускает.
    const synced = await matching.syncYmCatalog(USER, [row('A1', { barcodes: ['111'] })]);
    expect(synced.match.skipped).toBe(1);
    expect(productBy('A1').marketplaceSkus).toEqual({});
    expect(issues.documents).toHaveLength(1);

    await controller.link(id, { telegramUserId: USER, marketplace: 'ym', sku: 'A1' }, {});
    expect(productBy('A1').marketplaceSkus).toEqual({ ym: 'A1' });
    expect(issues.documents).toHaveLength(0);
  });

  it('перепривязка переносит карточку: она остаётся ровно у одного товара', async () => {
    await productService.upsertFromCatalog(USER, [row('A1'), row('B1')]);
    await productService.clearLink(USER, idBy('B1'), 'ym');

    const answer = await controller.link(
      idBy('B1'),
      { telegramUserId: USER, marketplace: 'ym', sku: 'A1' },
      { adminId: '42' },
    );

    expect(answer.movedFrom).toBe(idBy('A1'));
    expect(products.documents.filter((d) => d.marketplaceSkus?.ym === 'A1')).toHaveLength(1);
    expect(productBy('B1').marketplaceSkus).toEqual({ ym: 'A1' });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: PRODUCT_LINK_KIND,
        context: 'admin:42',
        telegramUserId: USER,
      }),
    );
  });

  it('у товара уже есть другая карточка — 409; чужой товар — 404; мусор — 400', async () => {
    await productService.upsertFromCatalog(USER, [row('A1')]);

    await expect(
      controller.link(idBy('A1'), { telegramUserId: USER, marketplace: 'ym', sku: 'Z9' }, {}),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      controller.link(idBy('A1'), { telegramUserId: '222', marketplace: 'ym', sku: 'Z9' }, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.link(idBy('A1'), { telegramUserId: USER, marketplace: 'amazon', sku: 'Z9' }, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.unmatched(USER, 'toString')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(record).not.toHaveBeenCalled();
  });

  it('после перепривязки прайс пишет закуп и историю в товар, который читает «Прибыль»', async () => {
    // Товар A1 из прайса; карточку A1 руками перенесли на товар M (другой internalSku).
    const day1 = new Date('2026-10-14T09:00:00Z');
    const day2 = new Date('2026-10-16T09:00:00Z');
    await productService.upsertFromPriceList(USER, [{ sku: 'A1', price: 1000 }], day1);
    await productService.upsertFromCatalog(USER, [row('M')]);
    await productService.clearLink(USER, idBy('M'), 'ym');
    await matching.link(USER, idBy('M'), 'ym', 'A1');

    const rows = [{ sku: 'A1', price: 1200 }];
    await productService.upsertFromPriceList(USER, rows, day2);
    await costHistory.recordPriceList(USER, rows, new Map([['A1', { price: 1000 }]]), day2);

    expect(productBy('M').purchase).toMatchObject({ price: 1200 });
    expect(productBy('A1').purchase).toMatchObject({ price: 1000 });
    expect(history.documents.every((d) => d.productId === idBy('M'))).toBe(true);
    // «Прибыль» читает по артикулу ЯМ — и видит ту же историю.
    expect((await costHistory.findForSkus(USER, ['A1'])).get('A1')).toHaveLength(2);
  });

  describe('каталог Ozon (TASK-129)', () => {
    it('карточка Ozon привязывается по штрихкоду к тому же товару, что карточка ЯМ; поля ЯМ не тронуты', async () => {
      await productService.upsertFromCatalog(USER, [
        row('YM-1', { barcodes: ['4600000000017'], vendorCode: 'V-1', salePrice: 1000 }),
      ]);

      const result = await matching.syncCatalog(USER, 'ozon', [
        row('OZ-1', { barcodes: ['4600000000017', '999'], salePrice: 1200 }),
      ]);

      expect(result.match).toMatchObject({ cards: 1, boundPercent: 100 });
      expect(result.match.matched.barcode).toBe(1);
      expect(result.written).toEqual({ inserted: 0, matched: 1 });
      expect(products.documents).toHaveLength(1);
      expect(productBy('YM-1')).toMatchObject({
        marketplaceSkus: { ym: 'YM-1', ozon: 'OZ-1' },
        marketplaceLinks: { ym: { source: 'seed' }, ozon: { source: 'barcode' } },
        salePrices: { ym: 1000, ozon: 1200 },
        // Мастер-поля — от каталога ЯМ (решение ozon_catalog_no_master_overwrite).
        barcodes: ['4600000000017'],
        vendorCode: 'V-1',
      });
    });

    it('без пары товар не заводится — карточка в очередь no_match с marketplace ozon', async () => {
      await productService.upsertFromCatalog(USER, [row('YM-1')]);

      const result = await matching.syncCatalog(USER, 'ozon', [row('OZ-NOPE')]);

      expect(result.match.created).toBe(0);
      expect(result.match.issues.no_match).toBe(1);
      expect(products.documents).toHaveLength(1);
      expect(issues.documents).toEqual([
        expect.objectContaining({ marketplace: 'ozon', sku: 'OZ-NOPE', reason: 'no_match' }),
      ]);
    });

    it('конфликт Ozon не трогает очередь ЯМ', async () => {
      await productService.upsertFromCatalog(USER, [row('P1'), row('P2'), row('P3')]);
      await productService.clearLink(USER, idBy('P3'), 'ym');
      await matching.syncYmCatalog(USER, [
        row('P1'),
        row('P2'),
        row('YM-X', { barcodes: ['777'] }),
      ]);
      const ymIssues = issues.documents.filter((d) => d.marketplace === 'ym').length;
      // Штрихкод — после прохода ЯМ: каталог ЯМ пишет мастер-поля и стёр бы его.
      for (const sku of ['P1', 'P2']) Object.assign(productBy(sku), { barcodes: ['111'] });

      await matching.syncCatalog(USER, 'ozon', [row('OZ-C', { barcodes: ['111'] })]);

      expect(issues.documents.filter((d) => d.marketplace === 'ym')).toHaveLength(ymIssues);
      expect(issues.documents.filter((d) => d.marketplace === 'ozon')).toEqual([
        expect.objectContaining({ sku: 'OZ-C', reason: 'conflict', level: 'barcode' }),
      ]);
    });

    it('ручная привязка Ozon переживает автоматический проход', async () => {
      await productService.upsertFromCatalog(USER, [row('A1', { barcodes: ['555'] }), row('B1')]);
      await controller.link(
        idBy('B1'),
        { telegramUserId: USER, marketplace: 'ozon', sku: 'OZ-A' },
        { adminId: '42' },
      );

      // Штрихкод карточки указывает на A1, но она уже руками у B1.
      await matching.syncCatalog(USER, 'ozon', [row('OZ-A', { barcodes: ['555'] })]);

      expect(productBy('B1')).toMatchObject({
        marketplaceSkus: { ozon: 'OZ-A' },
        marketplaceLinks: { ozon: { source: 'manual' } },
      });
      expect(productBy('A1')?.marketplaceSkus?.ozon).toBeUndefined();
    });
  });

  it('весь контроллер закрыт гвардом', () => {
    const guards = Reflect.getMetadata('__guards__', ProductAdminController) ?? [];
    expect(guards).toContain(AdminJwtGuard);
  });
});
