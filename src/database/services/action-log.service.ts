import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';

import { ActionLog, ActionLogDocument } from '../schemas/action-log.schema';

/** Одна запись журнала — ровно то, что знает о действии middleware. */
export interface IActionLogEntry {
  telegramUserId: string;
  /** `in` — от пользователя, `out` — от бота. По умолчанию `in`. */
  direction?: string;
  username?: string;
  name?: string;
  botId: string;
  chatId?: string;
  kind: string;
  action: string;
  status?: string;
  durationMs?: number;
  error?: string;
  /** Поля ниже заполняют ErrorReporter и самопроверка (HealthMonitorService). */
  source?: string;
  errorType?: string;
  stack?: string;
  httpStatus?: number;
  requestUrl?: string;
  context?: string;
}

/** Фильтр выборки для админского API. */
export interface IActionLogQuery {
  telegramUserId?: string;
  kind?: string;
  direction?: string;
  /** `ok` | `error`. Главный фильтр разбора: «покажи только сломавшееся». */
  status?: string;
  source?: string;
  since?: Date;
  until?: Date;
  limit?: number;
  skip?: number;
}

/** Потолок выдачи: без него `?limit=1000000` выгребает коллекцию в память. */
export const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 100;

/**
 * Метка «мусор»: 404 на несматченный маршрут — сплошь внешние сканеры,
 * прочёсывающие публичный IP на предмет утёкших секретов (`GET /.env`,
 * `/.git/config`, `/.aws/credentials`). Это `source` таких записей. В основном
 * журнале и в счётчике ошибок обзора они СКРЫТЫ (иначе вытеснили бы из
 * 90-дневного TTL то, ради чего журнал заведён), а видны в отдельной вкладке
 * «Мусор» — запрос с `source=scanner`.
 */
export const JUNK_SOURCE = 'scanner' as const;

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
      await this.model.create({ status: 'ok', direction: 'in', ...entry });
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
    if (query.direction) filter.direction = query.direction;
    if (query.status) filter.status = query.status;
    // Явный source (в т.ч. `scanner` для вкладки «Мусор») отбирает ровно его;
    // без source «мусор» сканеров ПРЯЧЕТСЯ — он не должен засорять ни основной
    // журнал, ни счётчик ошибок обзора (тот тоже ходит сюда без source).
    if (query.source) filter.source = query.source;
    else filter.source = { $ne: JUNK_SOURCE };
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
