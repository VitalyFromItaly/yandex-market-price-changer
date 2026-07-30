import { describe, it, expect, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';

import { PurchasePrice } from '../../src/database/schemas/purchase-price.schema';
import { PurchasePriceService } from '../../src/database/services/purchase-price.service';
import { inMemoryModel, type IInMemoryModel } from '../helpers/in-memory-model';

const USER = '111';
const OTHER = '222';

/**
 * Хранение закупочных цен.
 *
 * Главное, что проверяется, — скоуп и повторная загрузка: сервис
 * мультитенантный, а прайс присылают не один раз.
 */
describe('PurchasePriceService', () => {
  let model: IInMemoryModel;
  let service: PurchasePriceService;

  beforeEach(async () => {
    model = inMemoryModel();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PurchasePriceService,
        { provide: getModelToken(PurchasePrice.name), useValue: model },
      ],
    }).compile();

    service = moduleRef.get(PurchasePriceService);
  });

  it('пишет строки прайса и возвращает их количество', async () => {
    const saved = await service.upsertMany(USER, [
      { sku: 'A1', price: 100, name: 'ORIENT A1', category: 'ORIENT' },
      { sku: 'B2', price: 200 },
    ]);

    expect(saved).toBe(2);
    expect(model.documents).toHaveLength(2);
    expect(model.documents[0]).toMatchObject({ telegramUserId: USER, sku: 'A1', price: 100 });
  });

  it('пустой список не порождает запроса', async () => {
    expect(await service.upsertMany(USER, [])).toBe(0);
    expect(model.documents).toHaveLength(0);
  });

  it('повторная загрузка ОБНОВЛЯЕТ цену, а не создаёт второй документ', async () => {
    await service.upsertMany(USER, [{ sku: 'A1', price: 100 }]);
    await service.upsertMany(USER, [{ sku: 'A1', price: 150 }]);

    expect(model.documents).toHaveLength(1);
    expect(model.documents[0].price).toBe(150);
  });

  it('позиции, которых нет в новом файле, НЕ удаляются', async () => {
    // Прайс может прийти по одному бренду: удаление обнулило бы закуп по
    // остальному каталогу.
    await service.upsertMany(USER, [
      { sku: 'A1', price: 100 },
      { sku: 'B2', price: 200 },
    ]);
    await service.upsertMany(USER, [{ sku: 'A1', price: 150 }]);

    const costs = await service.findBySkus(USER, ['A1', 'B2']);
    expect(costs.get('A1').price).toBe(150);
    expect(costs.get('B2').price).toBe(200);
  });

  it('закуп читается картой sku → строка прайса', async () => {
    await service.upsertMany(USER, [
      { sku: 'A1', price: 100 },
      { sku: 'B2', price: 200 },
    ]);

    const costs = await service.findBySkus(USER, ['A1', 'B2', 'НЕТ']);

    expect(costs.get('A1').price).toBe(100);
    expect(costs.get('B2').price).toBe(200);
    expect(costs.has('НЕТ')).toBe(false);
    expect(costs.size).toBe(2);
  });

  it('наружу идёт ЦЕНА ПРАЙСА с названием и категорией — скидка вычитается позже', async () => {
    // Скидка применяется при расчёте, а не при записи: иначе смена процента
    // требовала бы перезагрузить прайс. Группу скидки определяют по этим полям.
    await service.upsertMany(USER, [
      { sku: 'V1', price: 5000, name: 'Восток Амфибия 420831', category: 'Восток' },
    ]);

    const row = (await service.findBySkus(USER, ['V1'])).get('V1');

    expect(row).toEqual({
      price: 5000,
      name: 'Восток Амфибия 420831',
      category: 'Восток',
    });
  });

  it('пустой список артикулов не идёт в базу', async () => {
    const costs = await service.findBySkus(USER, []);
    expect(costs.size).toBe(0);
  });

  it('ЧУЖОЙ закуп не виден: всё скоуплено по продавцу', async () => {
    await service.upsertMany(USER, [{ sku: 'A1', price: 100 }]);
    await service.upsertMany(OTHER, [{ sku: 'A1', price: 999 }]);

    expect((await service.findBySkus(USER, ['A1'])).get('A1').price).toBe(100);
    expect((await service.findBySkus(OTHER, ['A1'])).get('A1').price).toBe(999);
    expect(await service.countForUser(USER)).toBe(1);
  });

  it('дубли в запрошенном списке не ломают чтение', async () => {
    await service.upsertMany(USER, [{ sku: 'A1', price: 100 }]);

    const costs = await service.findBySkus(USER, ['A1', 'A1', 'A1']);
    expect(costs.get('A1').price).toBe(100);
  });

  it('дата последней загрузки — самая свежая, и своя у каждого продавца', async () => {
    await service.upsertMany(USER, [{ sku: 'A1', price: 100 }]);

    const first = await service.lastUpdatedAt(USER);
    expect(first).toBeInstanceOf(Date);

    expect(await service.lastUpdatedAt(OTHER)).toBeNull();
  });

  it('нулевая цена сохраняется: это валидное значение, а не «нет данных»', async () => {
    await service.upsertMany(USER, [{ sku: 'A1', price: 0 }]);

    const costs = await service.findBySkus(USER, ['A1']);
    // has() отличает «закуп ноль» от «закупа нет» — на этом стоит исключение
    // заказов из расчёта.
    expect(costs.has('A1')).toBe(true);
    expect(costs.get('A1').price).toBe(0);
  });
});
