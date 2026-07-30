import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';

import { ActionLog, ActionLogDocument } from '../schemas/action-log.schema';

/** Одна запись журнала — ровно то, что знает о действии middleware. */
export interface IActionLogEntry {
  telegramUserId: string;
  username?: string;
  name?: string;
  botId: string;
  chatId?: string;
  kind: string;
  action: string;
  status?: string;
  durationMs?: number;
  error?: string;
}

/** Фильтр выборки для админского API. */
export interface IActionLogQuery {
  telegramUserId?: string;
  kind?: string;
  since?: Date;
  until?: Date;
  limit?: number;
  skip?: number;
}

/** Потолок выдачи: без него `?limit=1000000` выгребает коллекцию в память. */
export const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 100;

@Injectable()
export class ActionLogService {
  private readonly logger = new Logger(ActionLogService.name);

  constructor(
    @InjectModel(ActionLog.name)
    private readonly model: Model<ActionLogDocument>,
  ) {}

  /**
   * Записать действие.
   *
   * Никогда не бросает. Журнал — побочная функция: недоступная Mongo не должна
   * превращать нажатие кнопки в «Произошла ошибка», ведь само действие
   * пользователя к базе журнала отношения не имеет. Провал записи виден в
   * консоли, и там же остаётся сама строка действия — то есть при лежащей базе
   * журнал деградирует до консольного, а не исчезает.
   */
  async record(entry: IActionLogEntry): Promise<void> {
    try {
      await this.model.create({ status: 'ok', ...entry });
    } catch (error) {
      this.logger.warn(`Не удалось записать действие в журнал: ${(error as Error).message}`);
    }
  }

  /**
   * Фильтр строится в ОДНОМ месте: list и count обязаны отбирать одно и то же,
   * иначе «показано 100 из 3» — расхождение, которое читается как потеря данных.
   */
  private filterOf(query: IActionLogQuery): FilterQuery<ActionLogDocument> {
    const filter: FilterQuery<ActionLogDocument> = {};

    if (query.telegramUserId) filter.telegramUserId = query.telegramUserId;
    if (query.kind) filter.kind = query.kind;
    if (query.since || query.until) {
      filter.createdAt = {};
      if (query.since) filter.createdAt.$gte = query.since;
      if (query.until) filter.createdAt.$lte = query.until;
    }

    return filter;
  }

  /** Выборка для админа: свежие сверху. */
  async list(query: IActionLogQuery = {}): Promise<ActionLogDocument[]> {
    return await this.model
      .find(this.filterOf(query))
      .sort({ createdAt: -1 })
      .skip(query.skip ?? 0)
      .limit(Math.min(query.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE))
      .lean<ActionLogDocument[]>()
      .exec();
  }

  /** Сколько записей подходит под фильтр — чтобы клиент знал про пагинацию. */
  async count(query: IActionLogQuery = {}): Promise<number> {
    return await this.model.countDocuments(this.filterOf(query)).exec();
  }
}
