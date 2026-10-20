import type {
  TCardIssueReason,
  TMarketplace,
  TMatchLevel,
} from '../../modules/products/product.domain';

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { ProductCardIssue, ProductCardIssueDocument } from '../schemas/product-card-issue.schema';

/** Причина ручной отвязки — единственная, которую проход не заменяет. */
const MANUAL_UNLINK: TCardIssueReason = 'manual_unlink';

/** Потолок страницы очереди в API. */
export const CARD_ISSUES_MAX_PAGE = 200;

/** Находка прохода для записи. */
export interface ICardIssueRow {
  sku: string;
  name?: string;
  reason: Exclude<TCardIssueReason, 'manual_unlink'>;
  level?: TMatchLevel;
  candidateIds: string[];
}

export interface ICardIssueQuery {
  telegramUserId?: string;
  marketplace?: TMarketplace;
  limit?: number;
  skip?: number;
}

/**
 * Очередь «не сопоставлено» (TASK-117). Скоуп — telegramUserId и площадка в
 * каждом фильтре записи. Правила — в схеме `ProductCardIssue`.
 */
@Injectable()
export class ProductCardIssueService {
  constructor(
    @InjectModel(ProductCardIssue.name)
    private readonly model: Model<ProductCardIssueDocument>,
  ) {}

  /** Артикулы карточек, отвязанных руками, — проход их пропускает. */
  async unlinkedSkus(telegramUserId: string, marketplace: TMarketplace): Promise<Set<string>> {
    const rows = await this.model
      .find({ telegramUserId, marketplace, reason: MANUAL_UNLINK })
      .select('sku')
      .lean()
      .exec();
    return new Set(rows.map((row) => row.sku));
  }

  /**
   * Заменить находки прохода целиком; ручные отвязки остаются. Отвязанные
   * карточки проход пропускает, поэтому их артикулов среди `rows` нет и
   * unique-индекс не встаёт.
   */
  async replaceAuto(
    telegramUserId: string,
    marketplace: TMarketplace,
    rows: readonly ICardIssueRow[],
    now: Date = new Date(),
  ): Promise<void> {
    await this.model
      .deleteMany({ telegramUserId, marketplace, reason: { $ne: MANUAL_UNLINK } })
      .exec();
    if (!rows.length) return;
    await this.model.insertMany(
      rows.map((row) => ({ ...row, telegramUserId, marketplace, detectedAt: now })),
    );
  }

  /** Ручная отвязка: карточка — в очередь, и автомат её больше не привяжет. */
  async markUnlinked(
    telegramUserId: string,
    marketplace: TMarketplace,
    sku: string,
    name: string | undefined,
    now: Date = new Date(),
  ): Promise<void> {
    await this.model
      .findOneAndUpdate(
        { telegramUserId, marketplace, sku },
        {
          $set: { reason: MANUAL_UNLINK, name, candidateIds: [], detectedAt: now },
          $unset: { level: 1 },
        },
        { upsert: true },
      )
      .exec();
  }

  /** Карточка привязана — из очереди её строка уходит, какой бы ни была причина. */
  async clear(telegramUserId: string, marketplace: TMarketplace, sku: string): Promise<void> {
    await this.model.deleteOne({ telegramUserId, marketplace, sku }).exec();
  }

  async list(query: ICardIssueQuery): Promise<{ items: ProductCardIssue[]; total: number }> {
    const filter: Record<string, string> = {};
    if (query.telegramUserId) filter.telegramUserId = query.telegramUserId;
    if (query.marketplace) filter.marketplace = query.marketplace;

    const limit = Math.min(Math.max(query.limit ?? 50, 1), CARD_ISSUES_MAX_PAGE);
    const skip = Math.max(query.skip ?? 0, 0);

    const [items, total] = await Promise.all([
      this.model.find(filter).sort({ detectedAt: -1 }).skip(skip).limit(limit).lean().exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }

  /** Удалить очередь продавца — вместе с его товарами. */
  async deleteForUser(telegramUserId: string): Promise<number> {
    const result = await this.model.deleteMany({ telegramUserId }).exec();
    return result.deletedCount ?? 0;
  }
}
