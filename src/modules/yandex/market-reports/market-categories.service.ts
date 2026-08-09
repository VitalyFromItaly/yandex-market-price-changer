import type { YandexMarketDocument } from '../../../database/schemas/yandex-market.schema';

import { Injectable } from '@nestjs/common';

import { YandexClientFactory } from '../yandex-client.factory';

/**
 * Категории каталога продавца — для пикера отчёта «Конкурентная позиция»
 * (метод требует ровно одну категорию, скалярно).
 *
 * Полный обход offer-mappings — ~28 страниц на живом каталоге, секунды.
 * Результат мемоизируется по businessId на 10 минут: пикер открывают повторно,
 * а каталог за минуты не меняется. Single-flight, как у FbyStockService, не
 * нужен — у offer-mappings нет лимита 1/мин, повторный обход лишь дороже.
 */

export interface ITopCategory {
  categoryId: number;
  name: string;
  offers: number;
}

const MEMO_TTL_MS = 10 * 60_000;

interface IMemoEntry {
  categories: ITopCategory[];
  freshUntil: number;
}

@Injectable()
export class MarketCategoriesService {
  private readonly memo = new Map<string, IMemoEntry>();

  constructor(private readonly clients: YandexClientFactory) {}

  /** Топ категорий каталога по числу товаров, убыв. */
  public async topCategories(store: YandexMarketDocument, limit = 8): Promise<ITopCategory[]> {
    const key = store.business_id;
    const now = Date.now();

    const cached = this.memo.get(key);
    if (cached && cached.freshUntil > now) return cached.categories.slice(0, limit);

    const usage = await this.clients.forStore(store).loadCategoryUsage();

    const categories = [...usage.entries()]
      .map(([categoryId, entry]) => ({
        categoryId,
        // Имя отсутствует у части товаров — категория остаётся видимой.
        name: entry.name ?? `Категория ${categoryId}`,
        offers: entry.count,
      }))
      .sort((a, b) => b.offers - a.offers);

    this.memo.set(key, { categories, freshUntil: now + MEMO_TTL_MS });
    return categories.slice(0, limit);
  }
}
