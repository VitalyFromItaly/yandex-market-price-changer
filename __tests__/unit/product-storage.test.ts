import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';

import { ProductCardIssue } from '../../src/database/schemas/product-card-issue.schema';
import { Product, ProductSchema } from '../../src/database/schemas/product.schema';
import { ProductCardIssueService } from '../../src/database/services/product-card-issue.service';
import { ProductService } from '../../src/database/services/product.service';
import { PurchasePriceService } from '../../src/database/services/purchase-price.service';
import { ProductMatchService } from '../../src/modules/products/product-match.service';
import { ProductSeedService } from '../../src/modules/yandex/products/product-seed.service';
import { YandexClientFactory } from '../../src/modules/yandex/yandex-client.factory';
import { inMemoryModel, type IInMemoryModel } from '../helpers/in-memory-model';

const USER = '111';

describe('Product: схема', () => {
  it('один товар на (продавец, internalSku) — дубль отсекает база', () => {
    const unique = ProductSchema.indexes().find(
      ([fields, options]) => options?.unique && 'internalSku' in fields,
    );
    expect(unique?.[0]).toEqual({ telegramUserId: 1, internalSku: 1 });
  });

  it('артикул ЯМ ищется индексом и принадлежит максимум одному товару', () => {
    const ym = ProductSchema.indexes().find(([fields]) => 'marketplaceSkus.ym' in fields);
    expect(ym?.[0]).toEqual({ telegramUserId: 1, 'marketplaceSkus.ym': 1 });
    expect(ym?.[1]).toMatchObject({
      unique: true,
      // Partial: товары без карточки ЯМ не должны делить «отсутствие».
      // `$exists`, не `$type`: планировщик не выводит $type из равенства.
      partialFilterExpression: { 'marketplaceSkus.ym': { $exists: true } },
    });
  });

  it('карточка Ozon и WB тоже привязана максимум к одному товару', () => {
    for (const marketplace of ['ozon', 'wb']) {
      const path = `marketplaceSkus.${marketplace}`;
      const index = ProductSchema.indexes().find(([fields]) => path in fields);
      expect(index?.[1]).toMatchObject({
        unique: true,
        partialFilterExpression: { [path]: { $exists: true } },
      });
    }
  });

  it('бренд не хранится — он выводится из имени и категории при чтении', () => {
    expect(ProductSchema.path('brand')).toBeUndefined();
  });
});

describe('ProductService', () => {
  let model: IInMemoryModel;
  let service: ProductService;

  beforeEach(async () => {
    model = inMemoryModel();
    const moduleRef = await Test.createTestingModule({
      providers: [ProductService, { provide: getModelToken(Product.name), useValue: model }],
    }).compile();
    service = moduleRef.get(ProductService);
  });

  it('свой склад из прайса — только у существующих товаров, с датой (TASK-142)', async () => {
    await service.upsertFromPriceList(USER, [{ sku: 'A1', price: 100 }]);
    const now = new Date('2026-10-18T10:00:00Z');

    expect(
      await service.setStockFromPriceList(
        USER,
        [
          { sku: 'A1', quantity: 7 },
          { sku: 'NEW', quantity: 3 },
        ],
        now,
      ),
    ).toEqual({ inserted: 0, matched: 1 });

    expect(model.documents).toHaveLength(1);
    expect(model.documents[0]).toMatchObject({ internalSku: 'A1', stock: 7, stockUpdatedAt: now });
  });

  it('прайс заводит товар с артикулом ЯМ и валютой, повтор — без дублей', async () => {
    const rows = [
      { sku: 'A1', price: 100, name: 'Casio A1', category: 'CASIO' },
      { sku: 'B1', price: 200 },
    ];

    expect(await service.upsertFromPriceList(USER, rows)).toEqual({ inserted: 2, matched: 0 });
    expect(await service.upsertFromPriceList(USER, rows)).toEqual({ inserted: 0, matched: 2 });

    expect(model.documents).toHaveLength(2);
    expect(model.documents[0]).toMatchObject({
      telegramUserId: USER,
      internalSku: 'A1',
      marketplaceSkus: { ym: 'A1' },
      purchase: { price: 100, currency: 'RUR' },
      name: 'Casio A1',
    });
  });

  it('новый прайс меняет цену и валюту на рубли, снимает курс, доп. расходы оставляет', async () => {
    await service.upsertFromPriceList(USER, [{ sku: 'A1', price: 100 }]);
    // Ручная правка: товар в долларах с доставкой.
    Object.assign(model.documents[0].purchase, { currency: 'USD', rate: 90, extraCosts: 5 });

    await service.upsertFromPriceList(USER, [{ sku: 'A1', price: 120 }]);

    // Цена прайса — рубли (решение product_manual_vs_price_list): иначе 120 ₽
    // легли бы рядом с USD и читались как 120 долларов.
    expect(model.documents[0].purchase).toEqual({ price: 120, currency: 'RUR', extraCosts: 5 });
  });

  it('listForCatalog — товары продавца с закупом, чужих нет', async () => {
    await service.upsertFromPriceList(USER, [{ sku: 'B2', price: 50, name: 'Casio B2' }]);
    await service.upsertFromPriceList('другой', [{ sku: 'X', price: 1 }]);

    const list = await service.listForCatalog(USER);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ internalSku: 'B2', name: 'Casio B2', purchase: { price: 50 } });
    expect(typeof list[0].id).toBe('string');
  });

  it('setPurchase заменяет закуп целиком — снятые поля исчезают', async () => {
    await service.upsertFromPriceList(USER, [{ sku: 'A1', price: 100 }]);
    Object.assign(model.documents[0].purchase, { extraCosts: 5 });
    const id = String(model.documents[0]._id);

    await service.setPurchase(USER, id, { price: 10, currency: 'USD', rate: 90 });
    expect(model.documents[0].purchase).toEqual({ price: 10, currency: 'USD', rate: 90 });

    await service.setPurchase('другой', id, { price: 1 });
    expect(model.documents[0].purchase.price).toBe(10);
  });

  it('каталог дописывает штрихкоды, но не перетирает название из прайса и закуп', async () => {
    await service.upsertFromPriceList(USER, [{ sku: 'A1', price: 100, name: 'Из прайса' }]);

    const result = await service.upsertFromCatalog(USER, [
      {
        sku: 'A1',
        name: 'Из каталога',
        vendor: 'Casio',
        vendorCode: 'GA-1',
        barcodes: ['4549'],
        salePrice: 1990,
      },
      { sku: 'Z9', name: 'Только в каталоге', barcodes: [] },
    ]);

    expect(result).toEqual({ inserted: 1, matched: 1 });
    expect(model.documents[0]).toMatchObject({
      name: 'Из прайса',
      vendor: 'Casio',
      vendorCode: 'GA-1',
      barcodes: ['4549'],
      salePrices: { ym: 1990 },
      purchase: { price: 100, currency: 'RUR' },
    });
    // Товар каталога без закупа: имя из каталога, закупа нет — себестоимость неизвестна.
    expect(model.documents[1]).toMatchObject({
      internalSku: 'Z9',
      name: 'Только в каталоге',
      marketplaceSkus: { ym: 'Z9' },
    });
    expect(model.documents[1].purchase).toBeUndefined();
  });

  it('карточка без цены не стирает прежнюю цену продажи', async () => {
    await service.upsertFromCatalog(USER, [{ sku: 'A1', barcodes: [], salePrice: 1990 }]);
    await service.upsertFromCatalog(USER, [{ sku: 'A1', barcodes: [] }]);

    expect(model.documents[0].salePrices).toEqual({ ym: 1990 });
  });

  it('поиск по артикулам ЯМ скоупится продавцом', async () => {
    await service.upsertFromPriceList(USER, [{ sku: 'A1', price: 1 }]);
    await service.upsertFromPriceList('222', [{ sku: 'A1', price: 2 }]);

    const found = await service.findByYmSkus(USER, ['A1', 'A1', 'нет']);
    expect(found.map((p) => p.purchase?.price)).toEqual([1]);
  });

  it('артикулы журнала площадки (TASK-181): сначала артикул ЯМ, без карточки ЯМ — свой артикул', async () => {
    model.documents.push(
      {
        telegramUserId: USER,
        internalSku: 'L',
        name: 'Связанный',
        marketplaceSkus: { ym: 'A1', ozon: 'OZ-1' },
      },
      {
        telegramUserId: USER,
        internalSku: 'O',
        name: 'Только Ozon',
        marketplaceSkus: { ozon: 'OZ-2' },
      },
      { telegramUserId: '222', internalSku: 'X', name: 'Чужой', marketplaceSkus: { ozon: 'OZ-3' } },
    );

    const ozon = await service.findByJournalSkus(USER, 'ozon', ['A1', 'OZ-2', 'OZ-3', 'нет']);
    expect([...ozon].map(([sku, p]) => [sku, p.name])).toEqual([
      ['A1', 'Связанный'],
      ['OZ-2', 'Только Ozon'],
    ]);
    // ЯМ — только артикул ЯМ: чужой артикул площадки ЯМ-журнал не подписывает.
    const ym = await service.findByJournalSkus(USER, 'ym', ['A1', 'OZ-2']);
    expect([...ym.keys()]).toEqual(['A1']);
  });

  it('поиск по словам: подстрока без регистра, все слова, ввод — текст, чужой продавец не виден', async () => {
    await service.upsertFromPriceList(USER, [
      { sku: 'F91W-1', price: 1, name: 'Casio F-91W-1YEF' },
      { sku: 'A158', price: 1, name: 'Casio A158WA' },
      { sku: 'AMF-420', price: 1, name: 'Восток Амфибия 420' },
    ]);
    await service.upsertFromPriceList('222', [{ sku: 'F91W-X', price: 1, name: 'Casio F-91W' }]);

    const f91 = await service.search(USER, 'f-91w', 10);
    expect(f91).toEqual({
      items: [
        expect.objectContaining({ internalSku: 'F91W-1', marketplaceSkus: { ym: 'F91W-1' } }),
      ],
      total: 1,
    });
    expect((await service.search(USER, 'casio  a158', 10)).items.map((p) => p.internalSku)).toEqual(
      ['A158'],
    );
    expect((await service.search(USER, 'амфибия', 10)).total).toBe(1);
    expect((await service.search(USER, 'casio восток', 10)).total).toBe(0);
    expect((await service.search(USER, '.*', 10)).total).toBe(0);

    const limited = await service.search(USER, 'casio', 1);
    expect(limited.items).toHaveLength(1);
    expect(limited.total).toBe(2);
  });
});

describe('ProductSeedService: начальное заполнение', () => {
  let model: IInMemoryModel;
  let seed: ProductSeedService;
  const loadCatalogProducts = vi.fn();

  beforeEach(async () => {
    model = inMemoryModel();
    loadCatalogProducts.mockResolvedValue([
      { offerId: 'A1', name: 'A1 каталог', barcodes: ['111'], vendorCode: 'A-1' },
      { offerId: 'C1', name: 'C1 каталог', barcodes: [] },
    ]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProductSeedService,
        ProductService,
        ProductMatchService,
        ProductCardIssueService,
        { provide: getModelToken(Product.name), useValue: model },
        { provide: getModelToken(ProductCardIssue.name), useValue: inMemoryModel() },
        {
          provide: PurchasePriceService,
          useValue: {
            listForSeed: async () => [
              { sku: 'A1', price: 100, name: 'A1 прайс' },
              { sku: 'B1', price: 200, name: 'B1 прайс' },
            ],
          },
        },
        { provide: YandexClientFactory, useValue: { forTenant: () => ({ loadCatalogProducts }) } },
      ],
    }).compile();
    seed = moduleRef.get(ProductSeedService);
  });

  const store = { telegramUserId: USER, token: 't', campaign_id: '1', business_id: '2' };

  it('объединение прайса и каталога; второй прогон ничего не заводит', async () => {
    const first = await seed.seed(store);

    expect(first).toEqual({
      priceListRows: 2,
      catalogOffers: 2,
      fromPriceList: { inserted: 2, matched: 0 },
      fromCatalog: { inserted: 1, matched: 1 },
      productsTotal: 3,
      catalogWithBarcodes: 1,
      catalogWithoutPurchase: 1,
      match: {
        cards: 2,
        // A1 заведён прайсом с тем же артикулом ЯМ — привязка уже есть.
        linked: 1,
        matched: { barcode: 0, vendorCode: 0, sku: 0 },
        created: 1,
        issues: { conflict: 0, shared: 0, sku_taken: 0, no_match: 0 },
        skipped: 0,
        boundPercent: 100,
      },
    });
    expect(model.documents.map((d) => d.internalSku).sort()).toEqual(['A1', 'B1', 'C1']);
    expect(model.documents.find((d) => d.internalSku === 'A1')).toMatchObject({
      name: 'A1 прайс',
      barcodes: ['111'],
      vendorCode: 'A-1',
    });

    const second = await seed.seed(store);
    expect(second.fromPriceList).toEqual({ inserted: 0, matched: 2 });
    expect(second.fromCatalog).toEqual({ inserted: 0, matched: 2 });
    expect(second.productsTotal).toBe(3);
    expect(second.match.linked).toBe(2);
  });
});
