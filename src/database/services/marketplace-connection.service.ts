import type {
  IConnectionAccount,
  TConnectionStatus,
  TStoredConnectionMarketplace,
} from '../schemas/marketplace-connection.schema';

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  MarketplaceConnection,
  MarketplaceConnectionDocument,
} from '../schemas/marketplace-connection.schema';

/** Подключение без кредов — всё, что можно показывать и передавать дальше. */
export interface IMarketplaceConnectionRow {
  telegramUserId: string;
  marketplace: TStoredConnectionMarketplace;
  status: TConnectionStatus;
  checkedAt?: Date;
  checkError?: string;
  accounts: IConnectionAccount[];
}

/** Запись подключения после проверки ключа площадкой (TASK-128/133). */
export interface IConnectionWrite {
  credentials: Record<string, string>;
  status: TConnectionStatus;
  checkError?: string;
  accounts?: IConnectionAccount[];
}

/**
 * Подключения Ozon/WB (TASK-127). Скоуп — telegramUserId в каждом фильтре.
 *
 * Креды читает только `credentialsOf`: в схеме они `select: false`, и все
 * прочие методы возвращают строку без них — поэтому ответ CRM, собранный из
 * них, не может нести ключ по построению.
 */
@Injectable()
export class MarketplaceConnectionService {
  constructor(
    @InjectModel(MarketplaceConnection.name)
    private readonly model: Model<MarketplaceConnectionDocument>,
  ) {}

  async findForUser(telegramUserId: string): Promise<IMarketplaceConnectionRow[]> {
    const docs = await this.model.find({ telegramUserId }).lean().exec();
    return docs.map(toRow);
  }

  async findOne(
    telegramUserId: string,
    marketplace: TStoredConnectionMarketplace,
  ): Promise<IMarketplaceConnectionRow | null> {
    const doc = await this.model.findOne({ telegramUserId, marketplace }).lean().exec();
    return doc ? toRow(doc) : null;
  }

  /**
   * Кто из списка подключил площадку — одним `$in` (TASK-131, ночная загрузка
   * финансов), а не запросом на продавца. Отвергнутый площадкой ключ не
   * считается: ночной импорт с ним только упал бы алертом каждую ночь.
   */
  async connectedUsers(
    marketplace: TStoredConnectionMarketplace,
    telegramUserIds: readonly string[],
  ): Promise<Set<string>> {
    if (!telegramUserIds.length) return new Set();
    const docs = await this.model
      .find(
        { marketplace, telegramUserId: { $in: [...telegramUserIds] }, status: { $ne: 'rejected' } },
        { telegramUserId: 1 },
      )
      .lean()
      .exec();
    return new Set(docs.map((doc) => doc.telegramUserId));
  }

  /** Ключи площадки — только для клиента площадки, никогда для ответа. */
  async credentialsOf(
    telegramUserId: string,
    marketplace: TStoredConnectionMarketplace,
  ): Promise<Record<string, string> | null> {
    const doc = await this.model
      .findOne({ telegramUserId, marketplace })
      .select('+credentials')
      .lean()
      .exec();
    return doc?.credentials ?? null;
  }

  /**
   * Одна атомарная запись (upsert), не find-then-create — довод
   * `upsertByTelegramUser` из «Known correctness bugs». Неудачную проверку
   * сюда не пишут: неверный ключ не должен перетереть рабочий (TASK-128).
   */
  async save(
    telegramUserId: string,
    marketplace: TStoredConnectionMarketplace,
    write: IConnectionWrite,
    now: Date = new Date(),
  ): Promise<IMarketplaceConnectionRow> {
    const doc = await this.model
      .findOneAndUpdate(
        { telegramUserId, marketplace },
        {
          $set: {
            credentials: write.credentials,
            status: write.status,
            checkedAt: now,
            checkError: write.checkError,
            accounts: write.accounts ?? [],
          },
          $setOnInsert: { telegramUserId, marketplace },
        },
        { upsert: true, new: true },
      )
      .exec();
    return toRow(doc);
  }

  /**
   * Итог повторной проверки записанного ключа («Проверить связь», TASK-161).
   * Креды не трогаются — ключ меняет только `save` после успешной проверки
   * нового. Пустой `accounts` не стирает записанные: при отказе кабинеты
   * неизвестны, а не пропали. null — подключения нет.
   */
  async markChecked(
    telegramUserId: string,
    marketplace: TStoredConnectionMarketplace,
    check: { status: TConnectionStatus; checkError?: string; accounts?: IConnectionAccount[] },
    now: Date = new Date(),
  ): Promise<IMarketplaceConnectionRow | null> {
    const $set: Record<string, unknown> = { status: check.status, checkedAt: now };
    if (check.accounts?.length) $set.accounts = check.accounts;
    const update = check.checkError
      ? { $set: { ...$set, checkError: check.checkError } }
      : { $set, $unset: { checkError: 1 } };
    const doc = await this.model
      .findOneAndUpdate({ telegramUserId, marketplace }, update, { new: true })
      .exec();
    return doc ? toRow(doc) : null;
  }

  async deleteForUser(telegramUserId: string): Promise<void> {
    await this.model.deleteMany({ telegramUserId }).exec();
  }
}

// Строка перечислением полей, а не раскладкой документа: `credentials`, если
// его кто-то выберет явно, сюда всё равно не попадёт.
function toRow(doc: MarketplaceConnection): IMarketplaceConnectionRow {
  return {
    telegramUserId: doc.telegramUserId,
    marketplace: doc.marketplace,
    status: doc.status,
    checkedAt: doc.checkedAt,
    checkError: doc.checkError,
    accounts: (doc.accounts ?? []).map((account) => ({ id: account.id, name: account.name })),
  };
}
