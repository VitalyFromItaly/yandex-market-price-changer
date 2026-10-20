import type { TBrandFilter } from './product-catalog.domain';
import type { IManualPurchaseInput, TPurchaseField } from './product-purchase.domain';
import type { IProductPurchase } from './product.domain';
import type { IDiscountConfig } from '../yandex/reports/profit';

import { Injectable } from '@nestjs/common';

import { CostHistoryService } from '../../database/services/cost-history.service';
import { ProductService } from '../../database/services/product.service';
import { YandexMarketService } from '../../database/services/yandex-market.service';
import { brandOf, brandTitle } from '../yandex/reports/brands';
import { discountsOf, ratesOf } from '../yandex/reports/profit';

import { costAt, costDayOf, costOn, manualWrites } from './cost-history.domain';
import {
  brandCounts,
  historyView,
  linksView,
  matchesProduct,
  pageOf,
  purchaseView,
} from './product-catalog.domain';
import { validateManualPurchase } from './product-purchase.domain';

/** Исход ручной правки закупа. */
export type TPurchaseUpdateOutcome =
  | { ok: true; written: number; card: IProductCardView }
  | { ok: false; code: 'PRODUCT_NOT_FOUND' }
  | { ok: false; code: 'INVALID_PURCHASE'; field: TPurchaseField; message: string };

export type IProductCardView = NonNullable<Awaited<ReturnType<ProductCatalogService['card']>>>;

/** Товар для `costsFor`: id и то, из чего считается себестоимость. */
export interface ICostsForProduct {
  id: string;
  name?: string;
  category?: string;
  purchase?: IProductPurchase | null;
}

/**
 * Раздел CRM «Товары» (TASK-118): список, карточка, ручная правка закупа.
 * Чтение и запись — сервисы базы; правила — чистые модули рядом. В
 * `src/modules/crm/` только доставка.
 *
 * Себестоимость везде — `costOn` на сегодняшний московский день с конфигом
 * скидок продавца: та же функция считает «Прибыль» и колонку «Закуп» «Прайса».
 */
@Injectable()
export class ProductCatalogService {
  constructor(
    private readonly products: ProductService,
    private readonly history: CostHistoryService,
    private readonly stores: YandexMarketService,
  ) {}

  /** Страница списка с поиском и фильтром бренда плюс опции фильтра. */
  async list(
    telegramUserId: string,
    query: { q?: string; brand?: TBrandFilter | null; page?: unknown; limit?: unknown },
    now: Date = new Date(),
  ) {
    const all = await this.products.listForCatalog(telegramUserId);
    const matched = all.filter((product) => matchesProduct(product, query));
    const { page, limit } = pageOf(query.page, query.limit);
    const slice = matched.slice((page - 1) * limit, page * limit);

    const [histories, config] = await Promise.all([
      this.history.findByProducts(
        telegramUserId,
        slice.map((product) => product.id),
      ),
      this.discounts(telegramUserId),
    ]);

    return {
      total: matched.length,
      totalAll: all.length,
      page,
      limit,
      brands: brandCounts(all),
      items: slice.map((product) => {
        const history = histories.get(product.id) ?? [];
        const brand = brandOf(product);
        return {
          id: product.id,
          internalSku: product.internalSku,
          name: product.name ?? null,
          vendor: product.vendor ?? null,
          brandTitle: brand ? brandTitle(brand) : null,
          purchase: purchaseView(costAt({ history, current: product.purchase }, now)),
          cost: costOn({ ...product, history, current: product.purchase }, config, now),
          marketplaceSkus: {
            ym: product.marketplaceSkus?.ym ?? null,
            ozon: product.marketplaceSkus?.ozon ?? null,
            wb: product.marketplaceSkus?.wb ?? null,
          },
        };
      }),
    };
  }

  /** Карточка товара продавца; чужой и несуществующий — `null`. */
  async card(telegramUserId: string, productId: string, now: Date = new Date()) {
    const product = await this.products.findOwned(telegramUserId, productId);
    if (!product) return null;

    const id = String((product as { _id?: unknown })._id);
    const [histories, config] = await Promise.all([
      this.history.findByProducts(telegramUserId, [id]),
      this.discounts(telegramUserId),
    ]);
    const history = histories.get(id) ?? [];
    const source = {
      name: product.name,
      category: product.category,
      history,
      current: product.purchase ?? null,
    };
    const brand = brandOf(product);

    return {
      id,
      internalSku: product.internalSku,
      name: product.name ?? null,
      category: product.category ?? null,
      vendor: product.vendor ?? null,
      vendorCode: product.vendorCode ?? null,
      barcodes: product.barcodes ?? [],
      brandTitle: brand ? brandTitle(brand) : null,
      purchase: purchaseView(costAt(source, now)),
      cost: costOn(source, config, now),
      purchaseUpdatedAt: product.purchaseUpdatedAt ?? null,
      // Истории нет — действует текущий закуп (неявная стартовая): экран так и
      // пишет, а не показывает пустую таблицу как «закупа нет».
      history: historyView(history),
      links: linksView(product),
    };
  }

  /**
   * Себестоимость штуки на сегодня по списку товаров (раздел «Склад», TASK-142):
   * те же история, скидки бренда и `costOn`, что у списка и карточки, — у «Склада»
   * и «Товаров» одна себестоимость по построению. Нет закупа — `null`, не 0.
   */
  async costsFor(
    telegramUserId: string,
    products: readonly ICostsForProduct[],
    now: Date = new Date(),
  ): Promise<Map<string, number | null>> {
    const costs = new Map<string, number | null>();
    if (!products.length) return costs;
    const [histories, config] = await Promise.all([
      this.history.findByProducts(
        telegramUserId,
        products.map((product) => product.id),
      ),
      this.discounts(telegramUserId),
    ]);
    for (const product of products) {
      const history = histories.get(product.id) ?? [];
      costs.set(
        product.id,
        costOn(
          {
            name: product.name,
            category: product.category,
            history,
            current: product.purchase ?? null,
          },
          config,
          now,
        ),
      );
    }
    return costs;
  }

  /**
   * Ручная правка закупа: проверка → записи истории `manualWrites` (стартовая со
   * СТАРЫМ закупом, если истории не было) → закуп товара → карточка заново.
   * Автор — telegramUserId из токена CRM, а не из тела.
   */
  async updatePurchase(
    telegramUserId: string,
    productId: string,
    input: IManualPurchaseInput,
    author: string,
    now: Date = new Date(),
  ): Promise<TPurchaseUpdateOutcome> {
    const checked = validateManualPurchase(input);
    if (checked.ok === false) {
      return {
        ok: false,
        code: 'INVALID_PURCHASE',
        field: checked.field,
        message: checked.message,
      };
    }

    const product = await this.products.findOwned(telegramUserId, productId);
    if (!product) return { ok: false, code: 'PRODUCT_NOT_FOUND' };

    const id = String((product as { _id?: unknown })._id);
    const today = costDayOf(now);
    if (!today) throw new Error(`Некорректная дата правки закупа: ${String(now)}`);

    const histories = await this.history.findByProducts(telegramUserId, [id]);
    const writes = manualWrites(
      { history: histories.get(id), current: product.purchase ?? null },
      checked.purchase,
      today,
    );
    const written = await this.history.recordManual(telegramUserId, id, writes, author);
    if (written) await this.products.setPurchase(telegramUserId, id, checked.purchase, now);

    const card = await this.card(telegramUserId, id, now);
    if (!card) return { ok: false, code: 'PRODUCT_NOT_FOUND' };
    return { ok: true, written, card };
  }

  /** Конфиг скидок продавца: без магазина — умолчания (скидка по умолчанию). */
  private async discounts(telegramUserId: string): Promise<IDiscountConfig> {
    const store = await this.stores.findByTelegramUser(telegramUserId);
    return discountsOf(ratesOf(store ?? {}));
  }
}
