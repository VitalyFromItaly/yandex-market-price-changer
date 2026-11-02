import type {
  IMatchableProduct,
  IProductCatalogRow,
  IProductPriceRow,
  IProductPurchase,
  IProductStockRow,
  TLinkSource,
  TMarketplace,
} from '../../modules/products/product.domain';

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { PRODUCT_BASE_CURRENCY } from '../../modules/products/product.domain';
import { MARKETPLACE_LABEL } from '../../shared/marketplace';
import { escapeRegExp } from '../../shared/regexp';
import { Product, ProductDocument } from '../schemas/product.schema';

/** Операции bulkWrite модели товаров. */
type TProductWrites = Parameters<Model<ProductDocument>['bulkWrite']>[0];

/** Сколько операций в одном bulkWrite: прайс — до двадцати тысяч строк. */
const UPSERT_CHUNK_SIZE = 1000;

/** Прайс в рублях: курс ручной валюты к его цене не относится. */
const UNSET_RATE = { 'purchase.rate': '' } as const;

/** Товар в объёме списка раздела «Товары» (TASK-118). */
export interface ICatalogListItem {
  id: string;
  internalSku: string;
  name?: string;
  category?: string;
  vendor?: string;
  vendorCode?: string;
  marketplaceSkus?: Partial<Record<TMarketplace, string>>;
  purchase?: IProductPurchase | null;
}

/** Найденный товар — ровно то, что нужно ИИ, чтобы спросить экономику по артикулу. */
export interface IProductSearchItem {
  internalSku: string;
  name?: string;
  vendorCode?: string;
  marketplaceSkus?: Partial<Record<TMarketplace, string>>;
}

/** Поля, в которых ищется слово запроса. */
const SEARCH_FIELDS = ['name', 'internalSku', 'vendorCode', 'marketplaceSkus.ym'] as const;

/** Обновление товара полями карточки каталога — по id уже найденного товара. */
export interface ICatalogMatchWrite {
  productId: string;
  row: IProductCatalogRow;
  /** Новая привязка карточки к товару; нет — товар уже привязан к ней. */
  link?: TLinkSource;
}

/** Ошибка приведения id в Mongo — значит, такого товара нет. */
function isCastError(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'CastError';
}

const idOf = (product: object): string => String((product as { _id?: unknown })._id);

export interface IProductUpsertResult {
  /** Новых товаров. */
  inserted: number;
  /** Уже бывших — им обновлены поля этого источника. */
  matched: number;
}

/**
 * Товары продавца. Скоуп — telegramUserId в каждом фильтре.
 *
 * Два источника пишут РАЗНЫЕ поля, и каждый трогает только свои: прайс не
 * стирает штрихкоды, каталог не стирает закуп. Ключ записи —
 * `(telegramUserId, internalSku)`; при заполнении internalSku = артикул ЯМ.
 */
@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(
    @InjectModel(Product.name)
    private readonly model: Model<ProductDocument>,
  ) {}

  /**
   * Закуп из прайса. `$set` — цена, название, категория: прайс — их источник,
   * новый файл обязан их обновить. Цена в прайсе — рубли, поэтому валюта
   * ставится рублями, а курс снимается: иначе рублёвая цена прайса легла бы
   * рядом с ручной валютой и читалась бы как цена в долларах. Доп. расходы —
   * свойство товара, прайс их не трогает (решение `product_manual_vs_price_list`).
   * Действующую себестоимость после ручной правки задаёт история, а не это поле.
   */
  async upsertFromPriceList(
    telegramUserId: string,
    rows: readonly IProductPriceRow[],
    now: Date = new Date(),
  ): Promise<IProductUpsertResult> {
    // Артикул прайса — это офер ЯМ. Товар, к которому карточка привязана
    // (возможно, руками и под другим internalSku), обновляется по id: иначе
    // закуп ушёл бы в товар с internalSku = артикулу, а «Прибыль» читала бы
    // по артикулу ЯМ совсем другой (TASK-117).
    const byYm = await this.mapByYmSkus(
      telegramUserId,
      rows.map((row) => row.sku),
    );

    const operations = rows.map((row) => {
      const set = {
        'purchase.price': row.price,
        'purchase.currency': PRODUCT_BASE_CURRENCY,
        name: row.name,
        category: row.category,
        purchaseUpdatedAt: now,
      };
      const productId = byYm.get(row.sku);
      if (productId) {
        return {
          updateOne: {
            filter: { _id: productId, telegramUserId },
            update: { $set: set, $unset: UNSET_RATE },
          },
        };
      }
      return {
        updateOne: {
          filter: { telegramUserId, internalSku: row.sku },
          update: {
            $setOnInsert: {
              'marketplaceSkus.ym': row.sku,
              'marketplaceLinks.ym': { source: 'seed', linkedAt: now },
            },
            $set: set,
            $unset: UNSET_RATE,
          },
          upsert: true,
        },
      };
    });

    return await this.write(telegramUserId, 'прайс', operations);
  }

  /**
   * Свой склад из прайса (TASK-142, решение `inventory_own_stock_from_price_list`).
   * Только СУЩЕСТВУЮЩИЕ товары: заводит товар закуп (`upsertFromPriceList`), а
   * товар без цены и без карточки — это строка, о которой нам нечего сказать.
   * Товар ищется тем же `resolveForPriceList`, что закуп и история, — иначе
   * остаток лёг бы в один товар, а закуп в другой. Позиции, которых в файле
   * нет, не трогаются: прайс может покрывать один бренд, дату даёт `stockUpdatedAt`.
   */
  async setStockFromPriceList(
    telegramUserId: string,
    rows: readonly IProductStockRow[],
    now: Date = new Date(),
  ): Promise<IProductUpsertResult> {
    const ids = await this.resolveForPriceList(
      telegramUserId,
      rows.map((row) => row.sku),
    );
    const operations = rows
      .filter((row) => ids.has(row.sku))
      .map((row) => ({
        updateOne: {
          filter: { _id: ids.get(row.sku), telegramUserId },
          update: { $set: { stock: row.quantity, stockUpdatedAt: now } },
        },
      }));
    return await this.write(telegramUserId, 'остаток прайса', operations);
  }

  /** Товары, у которых по последнему прайсу есть что-то на своём складе. */
  /**
   * Товары с ЛЮБЫМ количеством из прайса, включая ноль, — для «Передачи
   * остатков» (TASK-143): ноль в прайсе — тоже факт, и его надо донести до
   * площадок. `findWithOwnStock` нули отсекает: «Складу» они не нужны.
   */
  async findWithPriceListStock(telegramUserId: string): Promise<Product[]> {
    return await this.model
      .find({ telegramUserId, stock: { $type: 'number' } })
      .lean()
      .exec();
  }

  async findWithOwnStock(telegramUserId: string): Promise<Product[]> {
    return await this.model
      .find({ telegramUserId, stock: { $gt: 0 } })
      .lean()
      .exec();
  }

  /**
   * Карточки каталога ЯМ, для которых сопоставление (`matchCards`) решило
   * «завести товар». `$set` — то, что живёт на Маркете (бренд карточки,
   * артикул производителя, штрихкоды, цена продажи). Название — только
   * `$setOnInsert`: у товара из прайса название уже есть, и прайс — главный
   * его источник; каталог даёт имя лишь товару, которого в прайсе нет.
   *
   * Ключ — internalSku = артикул карточки. Вызывать в обход сопоставления
   * нельзя: занятый internalSku оно отправляет в очередь (`sku_taken`), а
   * здесь он молча переписал бы чужой товар.
   */
  async upsertFromCatalog(
    telegramUserId: string,
    rows: readonly IProductCatalogRow[],
    now: Date = new Date(),
  ): Promise<IProductUpsertResult> {
    const operations = rows.map((row) => {
      return {
        updateOne: {
          filter: { telegramUserId, internalSku: row.sku },
          update: {
            $setOnInsert: {
              'marketplaceSkus.ym': row.sku,
              'marketplaceLinks.ym': { source: 'seed', linkedAt: now },
              name: row.name,
            },
            $set: catalogFields(row, now),
          },
          upsert: true,
        },
      };
    });

    return await this.write(telegramUserId, 'каталог ЯМ', operations);
  }

  /**
   * Поля карточки каталога — в уже найденные товары, по id. С `link` товару
   * заодно ставится привязка к карточке (автоматическое сопоставление).
   * Название не трогается: у найденного товара оно уже есть.
   *
   * Каталог ЯМ пишет и поля мастер-товара (бренд, артикул производителя,
   * штрихкоды). Другая площадка пишет только своё: привязку и свою цену
   * продажи. Иначе каждый её проход перетирал бы штрихкоды ЯМ своими
   * (решение `ozon_catalog_no_master_overwrite`).
   */
  async applyCatalogMatches(
    telegramUserId: string,
    writes: readonly ICatalogMatchWrite[],
    now: Date = new Date(),
    marketplace: TMarketplace = 'ym',
  ): Promise<IProductUpsertResult> {
    const operations = writes
      .map(({ productId, row, link }) => {
        const set =
          marketplace === 'ym' ? catalogFields(row, now) : marketplaceFields(marketplace, row);
        if (link) {
          set[`marketplaceSkus.${marketplace}`] = row.sku;
          set[`marketplaceLinks.${marketplace}`] = { source: link, linkedAt: now };
        }
        return { productId, set };
      })
      .filter(({ set }) => Object.keys(set).length > 0)
      .map(({ productId, set }) => ({
        updateOne: { filter: { _id: productId, telegramUserId }, update: { $set: set } },
      }));
    return await this.write(
      telegramUserId,
      `карточки ${MARKETPLACE_LABEL[marketplace]}`,
      operations,
    );
  }

  /** Товары продавца в объёме сопоставления — одним запросом с проекцией. */
  async listForMatching(telegramUserId: string): Promise<IMatchableProduct[]> {
    const products = await this.model
      .find({ telegramUserId })
      .select('_id internalSku vendorCode barcodes marketplaceSkus')
      .lean()
      .exec();
    return products.map((product) => ({
      id: idOf(product),
      internalSku: product.internalSku,
      vendorCode: product.vendorCode,
      barcodes: product.barcodes,
      marketplaceSkus: product.marketplaceSkus,
    }));
  }

  /**
   * Все товары продавца в объёме списка «Товаров» — одним запросом с проекцией.
   * Целиком, а не страницей из Mongo: бренд не хранится (`brandOf` по имени и
   * категории), и фильтр по нему возможен только в памяти. ~20 тыс. строк по
   * восьми полям — единицы мегабайт.
   */
  async listForCatalog(telegramUserId: string): Promise<ICatalogListItem[]> {
    const products = await this.model
      .find({ telegramUserId })
      .select('_id internalSku name category vendor vendorCode marketplaceSkus purchase')
      .sort({ internalSku: 1 })
      .lean()
      .exec();
    return products.map((product) => ({
      id: idOf(product),
      internalSku: product.internalSku,
      name: product.name,
      category: product.category,
      vendor: product.vendor,
      vendorCode: product.vendorCode,
      marketplaceSkus: product.marketplaceSkus,
      purchase: product.purchase ?? null,
    }));
  }

  /**
   * Закуп товара целиком — ручная правка из CRM (TASK-118). Объект заменяется,
   * а не сливается: снятые в форме курс или доп. расходы должны исчезнуть.
   */
  async setPurchase(
    telegramUserId: string,
    productId: string,
    purchase: IProductPurchase,
    now: Date = new Date(),
  ): Promise<void> {
    await this.model
      .updateOne({ _id: productId, telegramUserId }, { $set: { purchase, purchaseUpdatedAt: now } })
      .exec();
  }

  /** Товар продавца по id; чужой, несуществующий и кривой id — `null`. */
  async findOwned(telegramUserId: string, productId: string): Promise<Product | null> {
    try {
      return await this.model.findOne({ _id: productId, telegramUserId }).lean().exec();
    } catch (error) {
      if (isCastError(error)) return null;
      throw error;
    }
  }

  /** Товары продавца по id — одним `$in` (кандидаты очереди «не сопоставлено»). */
  async findOwnedMany(telegramUserId: string, productIds: readonly string[]): Promise<Product[]> {
    if (!productIds.length) return [];
    return await this.model
      .find({ telegramUserId, _id: { $in: [...new Set(productIds)] } })
      .lean()
      .exec();
  }

  /** Товар, к которому привязана карточка площадки. */
  async findByMarketplaceSku(
    telegramUserId: string,
    marketplace: TMarketplace,
    sku: string,
  ): Promise<Product | null> {
    return await this.model
      .findOne({ telegramUserId, [`marketplaceSkus.${marketplace}`]: sku })
      .lean()
      .exec();
  }

  /** Привязать карточку к товару. Площадка — из белого списка (`isMarketplace`). */
  async setLink(
    telegramUserId: string,
    productId: string,
    marketplace: TMarketplace,
    sku: string,
    source: TLinkSource,
    now: Date = new Date(),
  ): Promise<void> {
    await this.model
      .updateOne(
        { _id: productId, telegramUserId },
        {
          $set: {
            [`marketplaceSkus.${marketplace}`]: sku,
            [`marketplaceLinks.${marketplace}`]: { source, linkedAt: now },
          },
        },
      )
      .exec();
  }

  /** Снять привязку товара на площадке. */
  async clearLink(
    telegramUserId: string,
    productId: string,
    marketplace: TMarketplace,
  ): Promise<void> {
    await this.model
      .updateOne(
        { _id: productId, telegramUserId },
        {
          $unset: {
            [`marketplaceSkus.${marketplace}`]: 1,
            [`marketplaceLinks.${marketplace}`]: 1,
          },
        },
      )
      .exec();
  }

  /**
   * Товары для строк прайса: артикул → id. Сначала по артикулу ЯМ (артикул
   * прайса — офер ЯМ, так его читает «Прибыль»), остальные — по internalSku,
   * как их заводит прайс. Так история себестоимости пишется в тот же товар,
   * из которого её прочитает отчёт, даже после ручной перепривязки.
   */
  async resolveForPriceList(
    telegramUserId: string,
    skus: readonly string[],
  ): Promise<Map<string, string>> {
    const resolved = await this.mapByYmSkus(telegramUserId, skus);
    const rest = skus.filter((sku) => !resolved.has(sku));
    for (const product of await this.findByInternalSkus(telegramUserId, rest)) {
      if (!resolved.has(product.internalSku)) resolved.set(product.internalSku, idOf(product));
    }
    return resolved;
  }

  /**
   * Поиск товара по словам запроса (TASK-164, инструмент ИИ `searchProducts`):
   * каждое слово обязано найтись хоть в одном поле — «casio f-91w» находит
   * «Casio F-91W-1YEF». Ввод экранирован (`escapeRegExp`), как в
   * `PurchasePriceService.list`: `.*` — это текст. Индекса под регэксп нет и не
   * нужно — фильтр по продавцу сужает скан до его товаров.
   */
  async search(
    telegramUserId: string,
    query: string,
    limit: number,
  ): Promise<{ items: IProductSearchItem[]; total: number }> {
    const words = query.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return { items: [], total: 0 };
    const filter = {
      telegramUserId,
      $and: words.map((word) => {
        const rx = new RegExp(escapeRegExp(word), 'i');
        return { $or: SEARCH_FIELDS.map((field) => ({ [field]: rx })) };
      }),
    };
    const [documents, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ internalSku: 1 })
        .limit(Math.max(1, Math.floor(limit)))
        .select('internalSku name vendorCode marketplaceSkus')
        .lean()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return {
      items: documents.map((product) => ({
        internalSku: product.internalSku,
        name: product.name,
        vendorCode: product.vendorCode,
        marketplaceSkus: product.marketplaceSkus,
      })),
      total,
    };
  }

  /** Товары по артикулам ЯМ — одним запросом с `$in`. */
  async findByYmSkus(telegramUserId: string, skus: readonly string[]): Promise<Product[]> {
    if (!skus.length) return [];
    return await this.model
      .find({ telegramUserId, 'marketplaceSkus.ym': { $in: [...new Set(skus)] } })
      .lean()
      .exec();
  }

  /**
   * Товары с привязанной карточкой площадки из списка (TASK-131): по ним импорт
   * финансов Ozon находит ключ закупа. Площадка — в пути запроса, поэтому
   * только из типа `TMarketplace`, не из ввода.
   */
  async findByMarketplaceSkus(
    telegramUserId: string,
    marketplace: TMarketplace,
    skus: readonly string[],
  ): Promise<Product[]> {
    if (!skus.length) return [];
    return await this.model
      .find({ telegramUserId, [`marketplaceSkus.${marketplace}`]: { $in: [...new Set(skus)] } })
      .lean()
      .exec();
  }

  /**
   * Товары по артикулам журнала площадки (TASK-181), ключ карты — артикул журнала.
   * Импорт Ozon/WB кладёт в журнал ключ закупа: артикул ЯМ привязанного товара,
   * а без карточки ЯМ — свой артикул площадки (`ozonPurchaseKeys`, `wbPurchaseKeys`).
   * Поэтому сначала артикул ЯМ, затем — для ненайденных — артикул площадки.
   */
  async findByJournalSkus(
    telegramUserId: string,
    marketplace: TMarketplace,
    skus: readonly string[],
  ): Promise<Map<string, Product>> {
    const bySku = new Map<string, Product>();
    for (const product of await this.findByYmSkus(telegramUserId, skus)) {
      const ym = product.marketplaceSkus?.ym;
      if (ym) bySku.set(ym, product);
    }
    const rest = skus.filter((sku) => !bySku.has(sku));
    if (marketplace === 'ym' || !rest.length) return bySku;
    for (const product of await this.findByMarketplaceSkus(telegramUserId, marketplace, rest)) {
      const own = product.marketplaceSkus?.[marketplace];
      if (own && !bySku.has(own)) bySku.set(own, product);
    }
    return bySku;
  }

  /** Товары по внутренним SKU — так их адресует загрузка прайса. */
  async findByInternalSkus(telegramUserId: string, skus: readonly string[]): Promise<Product[]> {
    if (!skus.length) return [];
    return await this.model
      .find({ telegramUserId, internalSku: { $in: [...new Set(skus)] } })
      .lean()
      .exec();
  }

  private async mapByYmSkus(
    telegramUserId: string,
    skus: readonly string[],
  ): Promise<Map<string, string>> {
    const byYm = new Map<string, string>();
    for (const product of await this.findByYmSkus(telegramUserId, skus)) {
      const sku = product.marketplaceSkus?.ym;
      if (sku) byYm.set(sku, idOf(product));
    }
    return byYm;
  }

  async countForUser(telegramUserId: string): Promise<number> {
    return await this.model.countDocuments({ telegramUserId }).exec();
  }

  /** Удалить товары продавца — при удалении пользователя из панели. */
  async deleteForUser(telegramUserId: string): Promise<number> {
    const result = await this.model.deleteMany({ telegramUserId }).exec();
    return result.deletedCount ?? 0;
  }

  private async write(
    telegramUserId: string,
    source: string,
    operations: TProductWrites,
  ): Promise<IProductUpsertResult> {
    const result: IProductUpsertResult = { inserted: 0, matched: 0 };
    if (!operations.length) return result;

    for (let i = 0; i < operations.length; i += UPSERT_CHUNK_SIZE) {
      const written = await this.model.bulkWrite(operations.slice(i, i + UPSERT_CHUNK_SIZE));
      result.inserted += written.upsertedCount ?? 0;
      result.matched += written.matchedCount ?? 0;
    }

    this.logger.log(
      `Товары ${telegramUserId} (${source}): новых ${result.inserted}, уже было ${result.matched}`,
    );
    return result;
  }
}

/** Поля карточки другой площадки: только её цена продажи, мастер-поля — от ЯМ. */
function marketplaceFields(
  marketplace: TMarketplace,
  row: IProductCatalogRow,
): Record<string, unknown> {
  return row.salePrice === undefined ? {} : { [`salePrices.${marketplace}`]: row.salePrice };
}

/** Поля карточки каталога, которые живут на Маркете и обновляются каждым проходом. */
function catalogFields(row: IProductCatalogRow, now: Date): Record<string, unknown> {
  const set: Record<string, unknown> = {
    vendor: row.vendor,
    vendorCode: row.vendorCode,
    barcodes: row.barcodes,
    catalogSyncedAt: now,
  };
  // Нет цены в карточке — прежнюю не стираем: «не прислали» ≠ «стала пустой».
  if (row.salePrice !== undefined) set['salePrices.ym'] = row.salePrice;
  return set;
}
