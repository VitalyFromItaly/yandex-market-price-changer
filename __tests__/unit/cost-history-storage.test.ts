import { describe, it, expect, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';

import { CostHistory, CostHistorySchema } from '../../src/database/schemas/cost-history.schema';
import { Product } from '../../src/database/schemas/product.schema';
import { CostHistoryService } from '../../src/database/services/cost-history.service';
import { ProductService } from '../../src/database/services/product.service';
import { inMemoryModel, type IInMemoryModel } from '../helpers/in-memory-model';

const USER = '111';

describe('CostHistory: схема', () => {
  it('одна запись на товар и день, одна стартовая на товар', () => {
    const unique = CostHistorySchema.indexes().find(([, options]) => options?.unique);
    expect(unique?.[0]).toEqual({ productId: 1, validFrom: 1 });
  });
});

describe('CostHistoryService', () => {
  let products: IInMemoryModel;
  let history: IInMemoryModel;
  let productService: ProductService;
  let service: CostHistoryService;

  beforeEach(async () => {
    products = inMemoryModel();
    history = inMemoryModel();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProductService,
        CostHistoryService,
        { provide: getModelToken(Product.name), useValue: products },
        { provide: getModelToken(CostHistory.name), useValue: history },
      ],
    }).compile();
    productService = moduleRef.get(ProductService);
    service = moduleRef.get(CostHistoryService);
  });

  /** Загрузка прайса так, как её делает StockSyncService: товары, потом история. */
  async function upload(price: number, previous: Map<string, { price: number }>, now: Date) {
    const rows = [{ sku: 'A1', price, name: 'Casio A1', category: 'CASIO' }];
    await productService.upsertFromPriceList(USER, rows, now);
    return await service.recordPriceList(USER, rows, previous, now);
  }

  it('прайс дважды с разной ценой — две записи: стартовая и дневная', async () => {
    const day1 = new Date('2026-10-14T09:00:00Z');
    const day2 = new Date('2026-10-16T09:00:00Z');

    expect(await upload(1000, new Map(), day1)).toBe(1);
    expect(await upload(1200, new Map([['A1', { price: 1000 }]]), day2)).toBe(1);

    expect(history.documents).toHaveLength(2);
    expect(history.documents).toEqual([
      expect.objectContaining({ validFrom: null, price: 1000, source: 'baseline' }),
      expect.objectContaining({ validFrom: '2026-10-16', price: 1200, source: 'price-list' }),
    ]);

    const bySku = await service.findForSkus(USER, ['A1']);
    expect(bySku.get('A1')).toHaveLength(2);
  });

  it('повторная загрузка того же прайса записей не создаёт', async () => {
    const now = new Date('2026-10-16T09:00:00Z');
    await upload(1000, new Map(), now);
    expect(await upload(1000, new Map([['A1', { price: 1000 }]]), now)).toBe(0);
    expect(history.documents).toHaveLength(1);
  });

  it('вторая смена за тот же день переписывает запись дня, а не копит соседнюю', async () => {
    const now = new Date('2026-10-16T09:00:00Z');
    await upload(1000, new Map(), new Date('2026-10-14T09:00:00Z'));
    await upload(1200, new Map([['A1', { price: 1000 }]]), now);
    await upload(1300, new Map([['A1', { price: 1200 }]]), now);

    expect(history.documents).toHaveLength(2);
    expect(history.documents[1]).toMatchObject({ validFrom: '2026-10-16', price: 1300 });
  });

  it('удаление продавца стирает его историю', async () => {
    await upload(1000, new Map(), new Date('2026-10-16T09:00:00Z'));
    expect(await service.deleteForUser(USER)).toBe(1);
    expect(history.documents).toHaveLength(0);
  });

  it('ручная правка: стартовая со старым закупом, запись дня с автором; поля прайса того же дня снимаются', async () => {
    const day = new Date('2026-10-17T09:00:00Z');
    // Прайс сегодня впервые изменил цену — есть стартовая и запись дня.
    await upload(1000, new Map(), new Date('2026-10-14T09:00:00Z'));
    await upload(1200, new Map([['A1', { price: 1000 }]]), day);
    const id = String(products.documents[0]._id);

    await service.recordManual(
      USER,
      id,
      [
        {
          validFrom: '2026-10-17',
          purchase: { price: 10, currency: 'USD', rate: 90 },
          source: 'manual',
        },
      ],
      '777',
    );

    const today = history.documents.find((doc) => doc.validFrom === '2026-10-17');
    expect(today).toMatchObject({
      price: 10,
      currency: 'USD',
      rate: 90,
      source: 'manual',
      author: '777',
    });
    expect(today).not.toHaveProperty('extraCosts');

    const records = (await service.findByProducts(USER, [id])).get(id);
    expect(records?.find((record) => record.validFrom === '2026-10-17')?.author).toBe('777');
    expect(records?.find((record) => record.validFrom === null)?.author).toBeUndefined();
  });

  it('прайс тем же днём поверх ручной записи снимает автора и курс', async () => {
    await upload(1000, new Map(), new Date('2026-10-14T09:00:00Z'));
    const id = String(products.documents[0]._id);
    await service.recordManual(
      USER,
      id,
      [
        {
          validFrom: '2026-10-17',
          purchase: { price: 10, currency: 'USD', rate: 90 },
          source: 'manual',
        },
      ],
      '777',
    );

    await upload(1300, new Map([['A1', { price: 1000 }]]), new Date('2026-10-17T12:00:00Z'));
    const today = history.documents.find((doc) => doc.validFrom === '2026-10-17');
    expect(today).toMatchObject({ price: 1300, currency: 'RUR', source: 'price-list' });
    expect(today).not.toHaveProperty('author');
    expect(today).not.toHaveProperty('rate');
  });
});
