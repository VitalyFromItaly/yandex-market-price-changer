import type { ICostHistoryWrite, ICostRecord } from '../../modules/products/cost-history.domain';
import type { IProductPriceRow } from '../../modules/products/product.domain';
import type { IPurchaseRow } from '../../modules/yandex/reports/profit';

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { costDayOf, historyWrites } from '../../modules/products/cost-history.domain';
import { CostHistory, CostHistoryDocument } from '../schemas/cost-history.schema';

import { ProductService } from './product.service';

/**
 * История себестоимости (TASK-116). Скоуп — telegramUserId в каждом фильтре.
 *
 * Решения — чистые функции `cost-history.domain.ts`; здесь только чтение и
 * запись. Товары ищутся через `ProductService`: история принадлежит товару.
 */
@Injectable()
export class CostHistoryService {
  private readonly logger = new Logger(CostHistoryService.name);

  constructor(
    @InjectModel(CostHistory.name)
    private readonly model: Model<CostHistoryDocument>,
    private readonly products: ProductService,
  ) {}

  /**
   * Загрузка прайса: записать изменения закупа. `previous` — строки закупа ДО
   * этой загрузки (материал стартовой записи). Возвращает число записей.
   */
  async recordPriceList(
    telegramUserId: string,
    rows: readonly IProductPriceRow[],
    previous: ReadonlyMap<string, IPurchaseRow>,
    now: Date = new Date(),
  ): Promise<number> {
    if (!rows.length) return 0;

    // Тот же товар, из которого «Прибыль» прочитает историю по артикулу ЯМ, —
    // даже если карточку перепривязали руками (TASK-117).
    const productIds = await this.products.resolveForPriceList(
      telegramUserId,
      rows.map((row) => row.sku),
    );
    const histories = await this.findByProducts(telegramUserId, [...productIds.values()]);

    const today = costDayOf(now);
    if (!today) return 0;

    const writes = historyWrites(rows, { productIds, histories, previous }, today);
    if (!writes.length) return 0;

    await this.model.bulkWrite(
      writes.map((write) => ({
        updateOne: {
          filter: { telegramUserId, productId: write.productId, validFrom: write.validFrom },
          update: recordUpdate(write),
          upsert: true,
        },
      })),
    );

    this.logger.log(`История себестоимости ${telegramUserId}: записей ${writes.length}`);
    return writes.length;
  }

  /**
   * Ручная правка закупа (TASK-118): записи `manualWrites` с автором. Запись того
   * же дня переписывается целиком — поля, которых у правки нет, снимаются, иначе
   * курс или доп. расходы прайса того же дня пережили бы правку.
   */
  async recordManual(
    telegramUserId: string,
    productId: string,
    writes: readonly Omit<ICostHistoryWrite, 'productId'>[],
    author: string,
  ): Promise<number> {
    if (!writes.length) return 0;

    await this.model.bulkWrite(
      writes.map((write) => ({
        updateOne: {
          filter: { telegramUserId, productId, validFrom: write.validFrom },
          update: recordUpdate(write, write.source === 'manual' ? author : undefined),
          upsert: true,
        },
      })),
    );

    this.logger.log(
      `Ручная правка закупа ${telegramUserId}/${productId}: записей ${writes.length}`,
    );
    return writes.length;
  }

  /** Истории по артикулам ЯМ (как в позициях заказов): артикул → записи. */
  async findForSkus(
    telegramUserId: string,
    skus: readonly string[],
  ): Promise<Map<string, ICostRecord[]>> {
    const bySku = new Map<string, ICostRecord[]>();
    if (!skus.length) return bySku;

    const products = await this.products.findByYmSkus(telegramUserId, skus);
    const skuOf = new Map<string, string>();
    for (const product of products) {
      const sku = product.marketplaceSkus?.ym;
      if (sku) skuOf.set(idOf(product), sku);
    }

    const histories = await this.findByProducts(telegramUserId, [...skuOf.keys()]);
    for (const [productId, records] of histories) {
      const sku = skuOf.get(productId);
      if (sku) bySku.set(sku, records);
    }
    return bySku;
  }

  /** Истории товаров — одним `$in`: id товара → записи. */
  async findByProducts(
    telegramUserId: string,
    productIds: readonly string[],
  ): Promise<Map<string, ICostRecord[]>> {
    const byProduct = new Map<string, ICostRecord[]>();
    if (!productIds.length) return byProduct;

    const docs = await this.model
      .find({ telegramUserId, productId: { $in: [...new Set(productIds)] } })
      .lean()
      .exec();

    for (const doc of docs) {
      const list = byProduct.get(doc.productId) ?? [];
      list.push({
        validFrom: doc.validFrom ?? null,
        price: doc.price,
        currency: doc.currency,
        rate: doc.rate,
        extraCosts: doc.extraCosts,
        source: doc.source,
        author: doc.author,
      });
      byProduct.set(doc.productId, list);
    }
    return byProduct;
  }

  /** Удалить историю продавца — при удалении пользователя из панели. */
  async deleteForUser(telegramUserId: string): Promise<number> {
    const result = await this.model.deleteMany({ telegramUserId }).exec();
    return result.deletedCount ?? 0;
  }
}

/**
 * `$set` известных полей и `$unset` отсутствующих: mongoose выкидывает
 * `undefined` из `$set`, и запись того же дня молча сохраняла бы чужой курс.
 */
function recordUpdate(
  write: Pick<ICostHistoryWrite, 'purchase' | 'source'>,
  author?: string,
): { $set: Record<string, unknown>; $unset?: Record<string, ''> } {
  const set: Record<string, unknown> = { price: write.purchase.price, source: write.source };
  const unset: Record<string, ''> = {};
  const optional = {
    currency: write.purchase.currency,
    rate: write.purchase.rate,
    extraCosts: write.purchase.extraCosts,
    author,
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value === undefined || value === null) unset[key] = '';
    else set[key] = value;
  }
  return Object.keys(unset).length ? { $set: set, $unset: unset } : { $set: set };
}

/** Id товара строкой: `lean()` отдаёт ObjectId, история хранит строку. */
function idOf(product: object): string {
  return String((product as { _id?: unknown })._id);
}
