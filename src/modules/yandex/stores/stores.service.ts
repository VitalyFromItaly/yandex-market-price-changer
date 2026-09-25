import type {
  IStoreEntry,
  YandexMarketDocument,
} from '../../../database/schemas/yandex-market.schema';

import { Injectable, Logger } from '@nestjs/common';

import { YandexMarketService } from '../../../database/services/yandex-market.service';
import { ErrorReporter } from '../../errors/error-reporter.service';
import { YandexAuthError } from '../yandex-api.errors';
import { YandexClientFactory } from '../yandex-client.factory';

import { botStoreAfterToken, findByKey, scopeStore } from './stores.domain';

/** Кто спрашивает — для журнала ошибок. Токен сюда не попадает никогда. */
export interface IStoreCallOrigin {
  telegramUserId: string;
  source: 'crm' | 'yandex';
  context: string;
}

/**
 * Итог запроса магазинов по токену. Отказ по токену и недоступность Маркета —
 * РАЗНЫЕ исходы: свернуть их в «магазинов нет» значит сказать продавцу с
 * отозванным токеном «попробуйте позже» (урок TASK-077, `autofillFromToken`).
 */
export type TStoreListResult =
  | { ok: true; stores: IStoreEntry[] }
  | { ok: false; reason: 'auth'; message: string }
  | { ok: false; reason: 'unavailable' };

export type TReplaceTokenResult =
  | { ok: true; stores: IStoreEntry[]; botStore: IStoreEntry | null }
  | { ok: false; reason: 'auth'; message: string }
  | { ok: false; reason: 'unavailable' | 'empty' | 'no-store' };

/**
 * Магазины токена для CRM: список, выбранный магазин, смена токена.
 *
 * Активный магазин бота здесь не пишется (решение владельца: смена магазина —
 * паттерн Telegram). Единственное исключение — `replaceToken`, когда новый
 * токен прежний магазин не открывает (см. `botStoreAfterToken`).
 */
@Injectable()
export class StoresService {
  private readonly logger = new Logger(StoresService.name);

  constructor(
    private readonly yandexMarket: YandexMarketService,
    private readonly clients: YandexClientFactory,
    private readonly errors: ErrorReporter,
  ) {}

  /** Один запрос `listStores` по токену; никогда не бросает. */
  async listByToken(token: string, origin: IStoreCallOrigin): Promise<TStoreListResult> {
    try {
      return { ok: true, stores: await this.clients.forTokenOnly(token).listStores() };
    } catch (error) {
      // Токен НЕ логируем.
      this.logger.warn(
        `Не удалось получить магазины пользователя ${origin.telegramUserId}: ${
          error instanceof Error ? error.constructor.name : 'неизвестная ошибка'
        }`,
      );
      void this.errors.report({
        error,
        source: origin.source,
        context: origin.context,
        telegramUserId: origin.telegramUserId,
        action: 'получение списка магазинов',
      });
      if (error instanceof YandexAuthError) {
        return { ok: false, reason: 'auth', message: error.userMessage };
      }
      return { ok: false, reason: 'unavailable' };
    }
  }

  /**
   * Магазины продавца — из кэша `YandexMarket.stores`; кэш пуст (подключён до
   * появления списка) — один запрос и запись, дальше снова без сети. Та же
   * логика, что у пикера смены в боте.
   */
  async cachedStores(
    telegramUserId: string,
    origin: IStoreCallOrigin,
  ): Promise<{ doc: YandexMarketDocument; stores: IStoreEntry[] } | null> {
    const doc = await this.yandexMarket.findByTelegramUser(telegramUserId);
    if (!doc) return null;
    if (doc.stores?.length) return { doc, stores: doc.stores };
    if (!doc.token) return { doc, stores: [] };

    const fresh = await this.listByToken(doc.token, origin);
    if (fresh.ok === false || !fresh.stores.length) return { doc, stores: [] };

    const saved = await this.yandexMarket.updateByTelegramUser(telegramUserId, {
      stores: fresh.stores,
    });
    return { doc: saved ?? doc, stores: fresh.stores };
  }

  /**
   * Магазин по ключу из URL: документ, перекрытый выбранной кампанией, её
   * запись в кэше и весь список. null — магазина нет или токен его не открывает.
   */
  async resolve(
    telegramUserId: string,
    key: string,
    origin: IStoreCallOrigin,
  ): Promise<{ store: YandexMarketDocument; entry: IStoreEntry; stores: IStoreEntry[] } | null> {
    const cached = await this.cachedStores(telegramUserId, origin);
    const entry = cached ? findByKey(cached.stores, key) : undefined;
    if (!cached || !entry) return null;

    const store = scopeStore(cached.doc, entry.campaignId);
    return store ? { store, entry, stores: cached.stores } : null;
  }

  /**
   * Новый токен — только после проверки: список магазинов по нему. Отказ,
   * недоступность или пустой список ничего не пишут, прежний токен остаётся.
   * Успех — одна запись: токен, кэш магазинов и (если прежний магазин новому
   * токену недоступен) активная кампания бота.
   */
  async replaceToken(
    telegramUserId: string,
    token: string,
    origin: IStoreCallOrigin,
  ): Promise<TReplaceTokenResult> {
    const doc = await this.yandexMarket.findByTelegramUser(telegramUserId);
    if (!doc) return { ok: false, reason: 'no-store' };

    const listed = await this.listByToken(token, origin);
    if (listed.ok === false) return listed;

    const pick = botStoreAfterToken(listed.stores, doc.campaign_id);
    if (!pick) return { ok: false, reason: 'empty' };

    await this.yandexMarket.updateByTelegramUser(telegramUserId, {
      token,
      stores: listed.stores,
      ...(pick.changed
        ? {
            campaign_id: pick.store.campaignId,
            business_id: pick.store.businessId,
            name: pick.store.storeName,
          }
        : {}),
    });

    return { ok: true, stores: listed.stores, botStore: pick.changed ? pick.store : null };
  }
}
