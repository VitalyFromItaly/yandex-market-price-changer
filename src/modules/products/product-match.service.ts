import type { IMatchSummary, IProductCatalogRow, TMarketplace } from './product.domain';
import type { ICardIssueRow } from '../../database/services/product-card-issue.service';
import type {
  ICatalogMatchWrite,
  IProductUpsertResult,
} from '../../database/services/product.service';

import { Injectable, Logger } from '@nestjs/common';

import { ProductCardIssueService } from '../../database/services/product-card-issue.service';
import { ProductService } from '../../database/services/product.service';
import { MARKETPLACE_LABEL } from '../../shared/marketplace';

import {
  CARD_ISSUE_LABEL,
  MATCH_LEVEL_LABEL,
  matchCards,
  summarizeMatches,
} from './product.domain';

/** Итог прохода по каталогу. */
export interface ICatalogSyncResult {
  match: IMatchSummary;
  /** Запись в товары: новые — заведённые по карточкам, matched — обновлённые. */
  written: IProductUpsertResult;
}

/** Исход ручной привязки или отвязки. */
export type TLinkOutcome =
  | {
      ok: true;
      productId: string;
      marketplace: TMarketplace;
      sku: string;
      movedFrom: string | null;
    }
  | { ok: false; code: 'PRODUCT_NOT_FOUND' | 'PRODUCT_HAS_CARD' | 'PRODUCT_HAS_NO_CARD' };

/** `kind` строки журнала о ручной привязке или отвязке карточки (админка и CRM). */
export const PRODUCT_LINK_KIND = 'product-link';

/** Отказы привязки словами — одни на админку и CRM «Товары». */
export const LINK_REFUSAL_TEXT = {
  PRODUCT_NOT_FOUND: 'Товар не найден',
  PRODUCT_HAS_CARD: 'У товара уже есть другая карточка этой площадки — сначала отвяжите её',
  PRODUCT_HAS_NO_CARD: 'У товара нет карточки этой площадки',
} as const;

/** Строка очереди «не сопоставлено» с причиной словами и кандидатами. */
export interface IUnmatchedCard {
  telegramUserId: string;
  marketplace: TMarketplace;
  sku: string;
  name: string | null;
  reason: string;
  reasonText: string;
  level: string | null;
  levelText: string | null;
  candidates: { productId: string; internalSku: string | null; name: string | null }[];
  detectedAt: Date;
}

/**
 * Сопоставление карточек площадок с товарами (TASK-117). Решения — чистая
 * `matchCards`; здесь чтение, запись и очередь «не сопоставлено».
 *
 * Товары здесь никогда не склеиваются и не удаляются — двигается только
 * привязка карточки. Поэтому история себестоимости (`CostHistory`, по id
 * товара) переезжать не должна: она принадлежит физическому товару, и после
 * перепривязки «Прибыль» по артикулу ЯМ читает историю того товара, к
 * которому карточка теперь привязана.
 */
@Injectable()
export class ProductMatchService {
  private readonly logger = new Logger(ProductMatchService.name);

  constructor(
    private readonly products: ProductService,
    private readonly issues: ProductCardIssueService,
  ) {}

  /**
   * Очередь «не сопоставлено» с кандидатами — для админки и CRM «Товары»
   * (TASK-118) одной сборкой: кандидаты — internalSku и название, чтобы выбирали
   * не по id. Одним запросом товаров на продавца, а не на строку. Без
   * `telegramUserId` — все продавцы (только админка); CRM передаёт своего всегда.
   */
  async unmatched(query: {
    telegramUserId?: string;
    marketplace?: TMarketplace;
    limit?: number;
    skip?: number;
  }): Promise<{ total: number; items: IUnmatchedCard[] }> {
    const { items, total } = await this.issues.list(query);

    const candidates = new Map<string, { internalSku: string; name?: string }>();
    const byUser = new Map<string, Set<string>>();
    for (const item of items) {
      const ids = byUser.get(item.telegramUserId) ?? new Set<string>();
      for (const id of item.candidateIds ?? []) ids.add(id);
      byUser.set(item.telegramUserId, ids);
    }
    for (const [user, ids] of byUser) {
      if (!ids.size) continue;
      for (const product of await this.products.findOwnedMany(user, [...ids])) {
        candidates.set(String((product as { _id?: unknown })._id), {
          internalSku: product.internalSku,
          name: product.name,
        });
      }
    }

    return {
      total,
      items: items.map((item) => ({
        telegramUserId: item.telegramUserId,
        marketplace: item.marketplace,
        sku: item.sku,
        name: item.name ?? null,
        reason: item.reason,
        reasonText: CARD_ISSUE_LABEL[item.reason] ?? item.reason,
        level: item.level ?? null,
        levelText: item.level ? MATCH_LEVEL_LABEL[item.level] : null,
        candidates: (item.candidateIds ?? []).map((id) => ({
          productId: id,
          internalSku: candidates.get(id)?.internalSku ?? null,
          name: candidates.get(id)?.name ?? null,
        })),
        detectedAt: item.detectedAt,
      })),
    };
  }

  /** Каталог ЯМ → товары. Обёртка над `syncCatalog`, вызовы ЯМ не менялись. */
  async syncYmCatalog(
    telegramUserId: string,
    rows: readonly IProductCatalogRow[],
    now: Date = new Date(),
  ): Promise<ICatalogSyncResult> {
    return await this.syncCatalog(telegramUserId, 'ym', rows, now);
  }

  /**
   * Каталог площадки → товары. На ЯМ карточка без пары заводит товар (решение
   * `product_match_ym_union`); на Ozon/WB — нет, она уходит в очередь как
   * `no_match`: товары продавца — это его прайс и каталог ЯМ, чужая карточка
   * без пары скорее ошибка сопоставления, чем новый товар. Конфликты — в
   * очередь. Привязки, уже стоящие у товаров (и ручные тоже), не трогаются,
   * отвязанные руками карточки пропускаются.
   */
  async syncCatalog(
    telegramUserId: string,
    marketplace: TMarketplace,
    rows: readonly IProductCatalogRow[],
    now: Date = new Date(),
  ): Promise<ICatalogSyncResult> {
    const createMissing = marketplace === 'ym';
    const [products, unlinked] = await Promise.all([
      this.products.listForMatching(telegramUserId),
      this.issues.unlinkedSkus(telegramUserId, marketplace),
    ]);

    const results = matchCards(rows, products, { marketplace, unlinked, createMissing });
    const rowOf = new Map(rows.map((row) => [row.sku.trim(), row]));

    const updates: ICatalogMatchWrite[] = [];
    const creates: IProductCatalogRow[] = [];
    const issues: ICardIssueRow[] = [];

    for (const { card, match } of results) {
      const row = rowOf.get(card.sku);
      if (!row) continue;
      if (match.kind === 'linked') updates.push({ productId: match.productId, row });
      else if (match.kind === 'matched') {
        updates.push({ productId: match.productId, row, link: match.level });
      } else if (match.kind === 'create') creates.push(row);
      else if (match.kind === 'issue') {
        issues.push({
          sku: card.sku,
          name: card.name,
          reason: match.reason,
          level: match.level,
          candidateIds: match.candidateIds,
        });
      }
    }

    const updated = await this.products.applyCatalogMatches(
      telegramUserId,
      updates,
      now,
      marketplace,
    );
    // `create` бывает только при createMissing — то есть только у ЯМ.
    const created = await this.products.upsertFromCatalog(telegramUserId, creates, now);
    await this.issues.replaceAuto(telegramUserId, marketplace, issues, now);

    const match = summarizeMatches(results);
    this.logger.log(
      `Сопоставление ${telegramUserId} (${MARKETPLACE_LABEL[marketplace]}): карточек ${match.cards}, ` +
        `с товаром ${match.boundPercent}%, в очереди ${issues.length}`,
    );
    return {
      match,
      written: {
        inserted: created.inserted,
        matched: updated.matched + created.matched,
      },
    };
  }

  /**
   * Ручная привязка. Карточка, привязанная к другому товару, переезжает (сначала
   * снимается там: unique-индекс по артикулу площадки иначе не дал бы записать).
   * У товара уже есть ДРУГАЯ карточка этой площадки — отказ: молча вытеснить её
   * значило бы потерять привязку, о которой админ не просил.
   */
  async link(
    telegramUserId: string,
    productId: string,
    marketplace: TMarketplace,
    sku: string,
    now: Date = new Date(),
  ): Promise<TLinkOutcome> {
    const product = await this.products.findOwned(telegramUserId, productId);
    if (!product) return { ok: false, code: 'PRODUCT_NOT_FOUND' };

    const current = product.marketplaceSkus?.[marketplace];
    if (current && current !== sku) return { ok: false, code: 'PRODUCT_HAS_CARD' };

    const owner = await this.products.findByMarketplaceSku(telegramUserId, marketplace, sku);
    const ownerId = owner ? String((owner as { _id?: unknown })._id) : null;
    const movedFrom = ownerId && ownerId !== productId ? ownerId : null;
    if (movedFrom) await this.products.clearLink(telegramUserId, movedFrom, marketplace);

    await this.products.setLink(telegramUserId, productId, marketplace, sku, 'manual', now);
    await this.issues.clear(telegramUserId, marketplace, sku);
    return { ok: true, productId, marketplace, sku, movedFrom };
  }

  /**
   * Удалить товары продавца вместе с его очередью «не сопоставлено» — одной
   * точкой, чтобы очередь не пережила товары, на которые ссылается.
   */
  async deleteForUser(telegramUserId: string): Promise<number> {
    const [deleted] = await Promise.all([
      this.products.deleteForUser(telegramUserId),
      this.issues.deleteForUser(telegramUserId),
    ]);
    return deleted;
  }

  /** Ручная отвязка: карточка — в очередь с `manual_unlink`, автомат её не вернёт. */
  async unlink(
    telegramUserId: string,
    productId: string,
    marketplace: TMarketplace,
    now: Date = new Date(),
  ): Promise<TLinkOutcome> {
    const product = await this.products.findOwned(telegramUserId, productId);
    if (!product) return { ok: false, code: 'PRODUCT_NOT_FOUND' };

    const sku = product.marketplaceSkus?.[marketplace];
    if (!sku) return { ok: false, code: 'PRODUCT_HAS_NO_CARD' };

    // Сначала очередь: оборвись запись между шагами, следующий проход увидит
    // отвязку и не вернёт привязку, а «лишняя» строка очереди безвредна.
    await this.issues.markUnlinked(telegramUserId, marketplace, sku, product.name, now);
    await this.products.clearLink(telegramUserId, productId, marketplace);
    return { ok: true, productId, marketplace, sku, movedFrom: null };
  }
}
