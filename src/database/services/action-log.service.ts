import type { IUpdateRow } from '../../modules/metrics/metrics.domain';

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
  /** Какой гейт отказал: `access` | `feature`. */
  refusedBy?: string;
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

  /**
   * Входящие апдейты окна — только поля свёртки метрик.
   *
   * Виды апдейтов передаются явно (`ACTION_KINDS`): direction `in` носят и
   * записи ошибок, самопроверки, рассылки и запросы CRM, а апдейтами бота они
   * не являются. Белый список видов, а не чёрный список чужих — новый вид
   * служебной записи иначе молча попал бы в «апдейты в час».
   */
  async findUpdatesSince(since: Date, kinds: readonly string[]): Promise<IUpdateRow[]> {
    return await this.model
      .find({ direction: 'in', kind: { $in: kinds }, createdAt: { $gte: since } })
      .select({
        _id: 0,
        createdAt: 1,
        telegramUserId: 1,
        username: 1,
        kind: 1,
        action: 1,
        status: 1,
        durationMs: 1,
        refusedBy: 1,
      })
      .lean<IUpdateRow[]>()
      .exec();
  }

  /** Последние неудачные вызовы Bot API (их пишет обёртка callApi, context `send:<метод>`). */
  async recentTelegramErrors(since: Date, limit: number): Promise<ActionLogDocument[]> {
    return await this.model
      .find({ status: 'error', source: 'bot', context: /^send:/, createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select({
        _id: 0,
        createdAt: 1,
        telegramUserId: 1,
        context: 1,
        httpStatus: 1,
        error: 1,
        action: 1,
      })
      .lean<ActionLogDocument[]>()
      .exec();
  }
}
