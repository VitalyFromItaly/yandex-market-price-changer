import type {
  IProfitSettings,
  IProfitSettingsInput,
  IStoreSettings,
  TPromoInput,
} from './store-settings.domain';
import type { YandexMarketDocument } from '../../../database/schemas/yandex-market.schema';
import type { TBrandKey } from '../reports/brands';
import type { TRateField } from '../reports/profit';
import type { TPromoConfig } from '../reports/promo';

import { Injectable } from '@nestjs/common';

import { PurchasePriceService } from '../../../database/services/purchase-price.service';
import { YandexMarketService } from '../../../database/services/yandex-market.service';
import { isBrandKey } from '../reports/brands';

import {
  storeSettingsOf,
  validateProfitSettings,
  validatePromoInput,
} from './store-settings.domain';

/**
 * Итог записи. `invalid` — ввод не принят (вопрос в боте остаётся открытым,
 * веб ставит ошибку под поле), `no-store` — магазина нет, писать некуда.
 */
export type TSettingsWriteResult =
  | { ok: true; store: YandexMarketDocument }
  | { ok: false; reason: 'invalid'; field: string; error: string }
  | { ok: false; reason: 'no-store' };

/**
 * Единственный путь записи настроек прибыли для бота и CRM: проверка из
 * store-settings.domain.ts, запись — в YandexMarketService. Изменение в одном
 * канале сразу видно в другом: документ один, правила одни.
 *
 * Фичи здесь не проверяются: `promotion` проверяет бот сам (ответ приходит
 * текстом мимо гейта), в CRM — гвард маршрута.
 */
@Injectable()
export class StoreSettingsService {
  constructor(
    private readonly stores: YandexMarketService,
    private readonly purchasePrices: PurchasePriceService,
  ) {}

  /** Снимок для экрана настроек CRM; null — магазина нет. */
  async settingsOf(telegramUserId: string): Promise<IStoreSettings | null> {
    const store = await this.stores.findByTelegramUser(telegramUserId);
    if (!store) return null;

    const rows = await this.purchasePrices.listNamesAndCategories(telegramUserId);
    return storeSettingsOf(store, rows);
  }

  /** Ставки и скидки по брендам — одной записью; пишется только присланное. */
  async setProfitSettings(
    telegramUserId: string,
    input: IProfitSettingsInput,
  ): Promise<TSettingsWriteResult> {
    return await this.write(input, (value) =>
      this.stores.updateProfitSettings(telegramUserId, value),
    );
  }

  /**
   * Одна ставка (бот). Проверка та же, что у формы; запись — узким методом
   * `updateRate`, который сам сводится к `updateProfitSettings`.
   */
  async setRate(
    telegramUserId: string,
    field: TRateField,
    value: number,
  ): Promise<TSettingsWriteResult> {
    return await this.write({ [field]: value }, () =>
      this.stores.updateRate(telegramUserId, field, value),
    );
  }

  /** Скидка одного бренда (бот) — зеркало `setRate`. */
  async setBrandDiscount(
    telegramUserId: string,
    brand: TBrandKey,
    value: number,
  ): Promise<TSettingsWriteResult> {
    return await this.write({ brandDiscounts: { [brand]: value } }, () =>
      this.stores.updateBrandDiscount(telegramUserId, brand, value),
    );
  }

  /**
   * Продвижение одного бренда. `null` — отключить (запись снимается, «—» на
   * экране, а не «0%»). Бот присылает уже собранный `TPromoConfig`, CRM — форму;
   * оба проходят одну и ту же `validatePromoInput`.
   */
  async setPromotion(
    telegramUserId: string,
    brand: string,
    input: TPromoInput | TPromoConfig | null,
  ): Promise<TSettingsWriteResult> {
    if (!isBrandKey(brand)) {
      return {
        ok: false,
        reason: 'invalid',
        field: 'brand',
        error: `Неизвестный бренд: ${brand}.`,
      };
    }

    let config: TPromoConfig | null = null;
    if (input !== null) {
      const validation = validatePromoInput(brand, input);
      if (validation.ok === false) {
        return { ok: false, reason: 'invalid', field: validation.field, error: validation.error };
      }
      config = validation.value;
    }

    const store = await this.stores.updatePromoCommission(telegramUserId, brand, config);
    return store ? { ok: true, store } : { ok: false, reason: 'no-store' };
  }

  /** Проверить, записать, свести итог к одному типу — общий шаг трёх методов выше. */
  private async write(
    input: IProfitSettingsInput,
    save: (value: IProfitSettings) => Promise<YandexMarketDocument | null>,
  ): Promise<TSettingsWriteResult> {
    const validation = validateProfitSettings(input);
    if (validation.ok === false) {
      return { ok: false, reason: 'invalid', field: validation.field, error: validation.error };
    }

    const store = await save(validation.value);
    return store ? { ok: true, store } : { ok: false, reason: 'no-store' };
  }
}
