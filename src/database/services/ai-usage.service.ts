import type { TAiUsageStatus } from '../schemas/ai-usage.schema';

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';

import { AiUsage, AiUsageDocument } from '../schemas/ai-usage.schema';

export interface IAiUsageRow {
  telegramUserId: string;
  purpose: string;
  model: string;
  responseModel: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  costRub: number;
  durationMs: number;
  traceId: string;
  status: TAiUsageStatus;
  httpStatus: number | null;
  errorCode: string | null;
}

/** Фильтр журнала ИИ-запросов в панели — один на страницу и счётчик. */
export interface IAiUsageQuery {
  telegramUserId?: string;
  purpose?: string;
  status?: TAiUsageStatus;
  since?: Date;
  until?: Date;
  limit?: number;
  skip?: number;
}

/** Потолок страницы: без него `?limit=1000000` выгребает коллекцию в память. */
export const MAX_AI_PAGE_SIZE = 100;
const DEFAULT_AI_PAGE_SIZE = 50;

export interface IAiSpend {
  costRub: number;
  requests: number;
  errors: number;
}

export interface IAiUsageTotals extends IAiSpend {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
}

export interface IAiUsageSummary {
  totals: IAiUsageTotals;
  /** День — `ГГГГ-ММ-ДД` по Москве; пустых дней здесь нет, их добивает домен. */
  byDay: (IAiSpend & { day: string })[];
  byUser: (IAiSpend & { telegramUserId: string })[];
  byPurpose: (IAiSpend & { purpose: string })[];
}

/** Поля одной свёртки: рубли, запросы, ошибки — одинаковые у всех разрезов. */
const SPEND_GROUP = {
  costRub: { $sum: '$costRub' },
  requests: { $sum: 1 },
  errors: { $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] } },
};

const EMPTY_TOTALS: IAiUsageTotals = {
  costRub: 0,
  requests: 0,
  errors: 0,
  promptTokens: 0,
  completionTokens: 0,
  cachedTokens: 0,
};

@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  constructor(
    @InjectModel(AiUsage.name)
    private readonly model: Model<AiUsageDocument>,
  ) {}

  /**
   * Записать один ИИ-запрос.
   *
   * Никогда не бросает (политика ActionLogService.record): ответ модели уже
   * получен и оплачен, и лежащая Mongo не должна превращать его в «ошибку».
   */
  async record(row: IAiUsageRow): Promise<void> {
    try {
      await this.model.create(row);
    } catch (error) {
      this.logger.warn(
        `Не удалось записать учёт ИИ (${row.telegramUserId}/${row.purpose}, ${row.costRub} ₽): ` +
          (error as Error).message,
      );
    }
  }

  /**
   * Сколько рублей продавец потратил на ИИ с момента `since`.
   *
   * Бросает: что делать, если сумму не узнать, решает AiService (отказ — решение
   * владельца `ai_limit_unknown_refuse`).
   */
  async spentRubSince(telegramUserId: string, since: Date): Promise<number> {
    const [row] = await this.model
      .aggregate<{
        total: number;
      }>([
        { $match: { telegramUserId, createdAt: { $gte: since } } },
        { $group: { _id: null, total: { $sum: '$costRub' } } },
      ])
      .exec();
    return row?.total ?? 0;
  }

  /**
   * Фильтр строится в ОДНОМ месте: list и count обязаны отбирать одно и то же,
   * иначе «показано 50 из 3» (довод ActionLogService.filterOf).
   */
  private filterOf(query: IAiUsageQuery): FilterQuery<AiUsageDocument> {
    const filter: FilterQuery<AiUsageDocument> = {};
    if (query.telegramUserId) filter.telegramUserId = query.telegramUserId;
    if (query.purpose) filter.purpose = query.purpose;
    if (query.status) filter.status = query.status;
    if (query.since || query.until) {
      filter.createdAt = {};
      if (query.since) filter.createdAt.$gte = query.since;
      if (query.until) filter.createdAt.$lte = query.until;
    }
    return filter;
  }

  /** Журнал ИИ-запросов для панели: свежие сверху. */
  async list(query: IAiUsageQuery = {}): Promise<(IAiUsageRow & { createdAt: Date })[]> {
    return await this.model
      .find(this.filterOf(query))
      .sort({ createdAt: -1 })
      .skip(query.skip ?? 0)
      .limit(Math.min(query.limit ?? DEFAULT_AI_PAGE_SIZE, MAX_AI_PAGE_SIZE))
      .lean<(IAiUsageRow & { createdAt: Date })[]>()
      .exec();
  }

  async count(query: IAiUsageQuery = {}): Promise<number> {
    return await this.model.countDocuments(this.filterOf(query)).exec();
  }

  /**
   * Расход за окно — ОДНИМ aggregate с $facet, в Mongo.
   *
   * Не в JS по страницам журнала: сумма на экране обязана совпадать с Σ costRub
   * в базе, а постраничная сборка теряет всё за потолком страницы. День — по
   * Москве (`timezone` в $dateToString): сутки сервера в UTC разрезали бы
   * вечерние запросы не туда, довод moscow-day.ts.
   */
  async summary(since: Date, until: Date): Promise<IAiUsageSummary> {
    const [row] = await this.model
      .aggregate<{
        totals: IAiUsageTotals[];
        byDay: (IAiSpend & { _id: string })[];
        byUser: (IAiSpend & { _id: string })[];
        byPurpose: (IAiSpend & { _id: string })[];
      }>([
        { $match: { createdAt: { $gte: since, $lte: until } } },
        {
          $facet: {
            totals: [
              {
                $group: {
                  _id: null,
                  ...SPEND_GROUP,
                  promptTokens: { $sum: '$promptTokens' },
                  completionTokens: { $sum: '$completionTokens' },
                  cachedTokens: { $sum: '$cachedTokens' },
                },
              },
            ],
            byDay: [
              {
                $group: {
                  _id: {
                    $dateToString: {
                      format: '%Y-%m-%d',
                      date: '$createdAt',
                      timezone: 'Europe/Moscow',
                    },
                  },
                  ...SPEND_GROUP,
                },
              },
              { $sort: { _id: 1 } },
            ],
            byUser: [
              { $group: { _id: '$telegramUserId', ...SPEND_GROUP } },
              { $sort: { costRub: -1, requests: -1 } },
            ],
            byPurpose: [
              { $group: { _id: '$purpose', ...SPEND_GROUP } },
              { $sort: { costRub: -1, requests: -1 } },
            ],
          },
        },
      ])
      .exec();

    const spend = (r: IAiSpend) => ({ costRub: r.costRub, requests: r.requests, errors: r.errors });
    const totals = row?.totals[0];
    return {
      totals: totals
        ? {
            ...spend(totals),
            promptTokens: totals.promptTokens,
            completionTokens: totals.completionTokens,
            cachedTokens: totals.cachedTokens,
          }
        : { ...EMPTY_TOTALS },
      byDay: (row?.byDay ?? []).map((r) => ({ day: r._id, ...spend(r) })),
      byUser: (row?.byUser ?? []).map((r) => ({ telegramUserId: r._id, ...spend(r) })),
      byPurpose: (row?.byPurpose ?? []).map((r) => ({ purpose: r._id, ...spend(r) })),
    };
  }
}
