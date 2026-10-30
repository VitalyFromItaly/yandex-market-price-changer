import type {
  IPriceSetPlan,
  IPriceSetProduct,
  IPriceSetRequest,
  IPriceSetTargetInput,
  IPriceSetTargetPlan,
} from './price-set.domain';
import type { ICatalogListItem } from '../../database/services/product.service';
import type { TMarketplace } from '../../shared/marketplace';
import type { TErrorSource } from '../errors/error-reporter.service';
import type {
  IMarketplaceConnectionRef,
  IMarketplacePriceWriteResult,
} from '../marketplaces/marketplace-adapter';
import type { TFeatureKey } from '../telegram/bots/shared/features.domain';

import { Injectable } from '@nestjs/common';

import { ActionLogService } from '../../database/services/action-log.service';
import { ProductService } from '../../database/services/product.service';
import { PurchasePriceService } from '../../database/services/purchase-price.service';
import { MARKETPLACES, MARKETPLACE_LABEL } from '../../shared/marketplace';
import { ErrorReporter } from '../errors/error-reporter.service';
import { MarketplaceNotConnectedError } from '../marketplaces/marketplace-adapter';
import { MarketplaceRegistry } from '../marketplaces/marketplace-registry.service';
import { FEATURE, isFeatureEnabled } from '../telegram/bots/shared/features.domain';
import { reportErrorMessage } from '../yandex/reports/report-message';

import { priceSetPlanOf, priceSetRowKey, priceSetSkusOf } from './price-set.domain';

/** Строка журнала записи — `actionlogs`, рядом с действиями продавца. */
export const PRICE_SET_LOG_KIND = 'price-set';

/**
 * Фича записи цен на площадку: у каждой своя — это запись в чужой кабинет, и
 * владелец открывает её по продавцу и по площадке (как `STOCK_PUSH_WRITE_FEATURE`).
 */
export const PRICE_SET_WRITE_FEATURE: Readonly<Record<TMarketplace, TFeatureKey>> = {
  ym: FEATURE.PRICE_SET_WRITE_YM,
  ozon: FEATURE.PRICE_SET_WRITE_OZON,
  wb: FEATURE.PRICE_SET_WRITE_WB,
};

/** Открыта ли запись хоть на одну площадку — есть ли смысл в кнопке и в apply. */
export function priceSetWriteOpen(features: Readonly<Record<string, boolean>>): boolean {
  return MARKETPLACES.some((marketplace) =>
    isFeatureEnabled(features, PRICE_SET_WRITE_FEATURE[marketplace]),
  );
}

/** Продавец подтверждал другие числа: между превью и записью цены на площадке изменились. */
export class PriceSetPlanChangedError extends Error {
  readonly userMessage =
    'Цены изменились после того, как вы смотрели план: их поменяли в кабинете площадки ' +
    'или обновился закуп. Пересчитайте план и проверьте его ещё раз — ничего не записано.';

  constructor() {
    super('price-set: план изменился, запись отменена');
    this.name = 'PriceSetPlanChangedError';
  }
}

/** Наценка от закупа без открытого «Закупа из прайса»: закупа продавцу не видно. */
export class PriceSetMarkupClosedError extends Error {
  readonly userMessage =
    'Наценка от закупа недоступна: закупочные цены из прайса у вас закрыты. Загрузите цены файлом.';

  constructor() {
    super('price-set: наценка без purchase_prices');
    this.name = 'PriceSetMarkupClosedError';
  }
}

export interface IPriceSetPlanResult {
  plan: IPriceSetPlan;
  /** Тот же запрос, по которому `apply` пересчитает план. */
  request: IPriceSetRequest;
  /** Последнее обновление закупа из прайса; null — прайса не было. */
  priceListAt: string | null;
  /** Почему цены площадки не прочитались — текстом для продавца. */
  readErrors: Partial<Record<TMarketplace, string>>;
  /** Выбранные площадки, которые не спрашивались: не подключены или закрыты фичей. */
  notConsidered: { marketplace: TMarketplace; reason: string }[];
}

export interface IPriceSetWriteOutcome {
  marketplace: TMarketplace;
  requested: number;
  written: number;
  errors: { batch: number; message: string }[];
  skipped: { sku: string; reason: string }[];
  skipReason?: IMarketplacePriceWriteResult['skipReason'];
}

export interface IPriceSetApplyResult {
  plan: IPriceSetPlan;
  writes: IPriceSetWriteOutcome[];
}

/** Площадка → source журнала ошибок: сбой записи — сбой этой площадки. */
const ERROR_SOURCE: Readonly<Record<TMarketplace, TErrorSource>> = {
  ym: 'yandex',
  ozon: 'ozon',
  wb: 'wb',
};

/** Почему функция записи площадки ничего не отправила — строкой журнала. */
const WRITE_SKIP_TEXT: Readonly<
  Record<NonNullable<IMarketplacePriceWriteResult['skipReason']>, string>
> = {
  'write-disabled': 'проверка без записи (PRICE_WRITE_ENABLED=false)',
  'no-access': 'у токена нет права «Цены и скидки»',
};

/**
 * «Установка цен» (TASK-202): собирает факты для чистого `priceSetPlanOf` и
 * пишет его итог через возможность реестра `priceWrite`.
 *
 * План от фичи записи не зависит в том смысле, что строки считаются всегда:
 * площадка с закрытой записью — тот же просмотр «что бы записали»
 * (`no-write-method`), её не пишет только `apply`. Закуп — цена из прайса как
 * есть (решение `price_set_purchase_raw`). Площадки опрашиваются по очереди:
 * квоты — на токен.
 */
@Injectable()
export class PriceSetService {
  constructor(
    private readonly marketplaces: MarketplaceRegistry,
    private readonly products: ProductService,
    private readonly purchasePrices: PurchasePriceService,
    private readonly actionLog: ActionLogService,
    private readonly errors: ErrorReporter,
  ) {}

  /** Только чтение: товары, текущие цены выбранных площадок, план. */
  async plan(
    telegramUserId: string,
    features: Readonly<Record<string, boolean>>,
    request: IPriceSetRequest,
  ): Promise<IPriceSetPlanResult> {
    const { desired } = request;
    if (desired.source === 'markup' && !isFeatureEnabled(features, FEATURE.PURCHASE_PRICES)) {
      throw new PriceSetMarkupClosedError();
    }

    const products = (await this.products.listForCatalog(telegramUserId)).map(priceSetProductOf);
    const targets: IPriceSetTargetInput[] = [];
    const readErrors: IPriceSetPlanResult['readErrors'] = {};
    const notConsidered: IPriceSetPlanResult['notConsidered'] = [];

    for (const marketplace of MARKETPLACES) {
      if (!request.marketplaces.includes(marketplace)) continue;
      if (marketplace !== 'ym' && !isFeatureEnabled(features, marketplaceFeature(marketplace))) {
        notConsidered.push({ marketplace, reason: 'функция площадки закрыта' });
        continue;
      }
      const writer = this.marketplaces.capability(marketplace, 'priceWrite');
      if (!writer) {
        notConsidered.push({ marketplace, reason: 'цены площадки не читаются' });
        continue;
      }
      const ref: IMarketplaceConnectionRef = { telegramUserId, marketplace };
      let current: IPriceSetTargetInput['current'] = null;
      try {
        current = await writer.currentPrices(ref, priceSetSkusOf(products, desired, marketplace));
      } catch (caught) {
        if (caught instanceof MarketplaceNotConnectedError) {
          notConsidered.push({ marketplace, reason: 'площадка не подключена' });
          continue;
        }
        readErrors[marketplace] = reportErrorMessage(caught);
        void this.errors.report({
          error: caught,
          source: ERROR_SOURCE[marketplace],
          context: `price-set:read:${marketplace}`,
          action: 'текущие цены',
          telegramUserId,
        });
      }
      targets.push({
        marketplace,
        current,
        writable: isFeatureEnabled(features, PRICE_SET_WRITE_FEATURE[marketplace]),
      });
    }

    const updatedAt =
      desired.source === 'markup' ? await this.purchasePrices.lastUpdatedAt(telegramUserId) : null;
    return {
      plan: priceSetPlanOf({ products, desired, targets }),
      request,
      priceListAt: updatedAt ? updatedAt.toISOString() : null,
      readErrors,
      notConsidered,
    };
  }

  /**
   * Запись по кнопке. План пересчитывается здесь же по тому же запросу и
   * пишется, только если его отпечаток совпал с тем, что видел продавец.
   * Отпечаток — по всему плану: выбор площадок и снятые строки сужают запись,
   * а не то, что продавец видел.
   */
  async apply(
    telegramUserId: string,
    features: Readonly<Record<string, boolean>>,
    request: IPriceSetRequest,
    planHash: string,
    /** Отмеченные продавцом площадки; нет — все с открытой записью. */
    marketplaces?: readonly TMarketplace[],
    /** Снятые в превью строки — ключи `priceSetRowKey`. */
    excluded: readonly string[] = [],
  ): Promise<IPriceSetApplyResult> {
    // Повтор гварда маршрута — барьер не только в доставке (довод writeInBatches).
    if (!priceSetWriteOpen(features)) {
      throw new Error('price-set: запись закрыта — ни одна фича price_set_write_* не открыта');
    }
    const { plan } = await this.plan(telegramUserId, features, request);
    if (plan.planHash !== planHash) throw new PriceSetPlanChangedError();

    const only = marketplaces ? new Set(marketplaces) : undefined;
    const skip = new Set(excluded);
    const writes: IPriceSetWriteOutcome[] = [];
    for (const target of plan.targets) {
      if (target.blockedBy !== null) continue;
      if (only && !only.has(target.marketplace)) continue;
      if (!isFeatureEnabled(features, PRICE_SET_WRITE_FEATURE[target.marketplace])) continue;
      const updates = target.updates
        .filter((row) => !skip.has(priceSetRowKey(target.marketplace, row.mpSku)))
        .map((row) => ({ sku: row.mpSku, price: row.send }));
      if (!updates.length) continue;

      const outcome = await this.writeTarget(telegramUserId, target.marketplace, updates);
      writes.push(outcome);
      this.journal(telegramUserId, target, outcome);
    }
    return { plan, writes };
  }

  private async writeTarget(
    telegramUserId: string,
    marketplace: TMarketplace,
    updates: { sku: string; price: number }[],
  ): Promise<IPriceSetWriteOutcome> {
    let result: IMarketplacePriceWriteResult;
    try {
      result = await this.marketplaces
        .require(marketplace, 'priceWrite', telegramUserId)
        .writePrices({ telegramUserId, marketplace }, updates);
    } catch (caught) {
      // Сбой одной площадки не отменяет уже записанное на другие: продавец должен
      // видеть, что ушло, а что нет. Ошибка — админам и строкой результата.
      void this.errors.report({
        error: caught,
        source: ERROR_SOURCE[marketplace],
        context: 'price-set:write',
        telegramUserId,
      });
      result = {
        written: 0,
        errors: [{ batch: 0, message: reportErrorMessage(caught) }],
        skipped: [],
      };
    }
    if (result.errors.length) {
      void this.errors.report({
        error: new Error(
          `Установка цен: ${result.errors.length} ошибок записи, ${MARKETPLACE_LABEL[marketplace]}`,
        ),
        source: ERROR_SOURCE[marketplace],
        context: 'price-set:write',
        telegramUserId,
      });
    }
    return {
      marketplace,
      requested: updates.length,
      written: result.written,
      errors: result.errors.map(({ batch, message }) => ({ batch, message })),
      skipped: result.skipped,
      ...(result.skipReason ? { skipReason: result.skipReason } : {}),
    };
  }

  private journal(
    telegramUserId: string,
    target: IPriceSetTargetPlan,
    outcome: IPriceSetWriteOutcome,
  ): void {
    void this.actionLog.record({
      telegramUserId,
      botId: 'crm',
      direction: 'out',
      kind: PRICE_SET_LOG_KIND,
      action:
        `установка цен в ${MARKETPLACE_LABEL[target.marketplace]}: ` +
        `записано ${outcome.written} из ${outcome.requested}` +
        (outcome.skipped.length ? `, не отправлено ${outcome.skipped.length}` : ''),
      status: outcome.errors.length || outcome.skipReason ? 'error' : 'ok',
      ...(outcome.skipReason
        ? { error: `запись пропущена: ${WRITE_SKIP_TEXT[outcome.skipReason]}` }
        : {}),
      context: `price-set:${target.marketplace}`,
      details: {
        marketplace: target.marketplace,
        requested: outcome.requested,
        skipped: outcome.skipped.length,
        written: outcome.written,
        failedBatches: outcome.errors.length,
      },
    });
  }
}

function marketplaceFeature(marketplace: Exclude<TMarketplace, 'ym'>): TFeatureKey {
  return marketplace === 'ozon' ? FEATURE.OZON : FEATURE.WB;
}

/** Товар справочника → строка плана; закуп — цена из прайса как есть (`price_set_purchase_raw`). */
function priceSetProductOf(product: ICatalogListItem): IPriceSetProduct {
  const skus: IPriceSetProduct['skus'] = {};
  for (const marketplace of MARKETPLACES) {
    const sku = product.marketplaceSkus?.[marketplace];
    if (sku) skus[marketplace] = sku;
  }
  const price = product.purchase?.price;
  return {
    sku: product.internalSku,
    name: product.name ?? null,
    purchase: typeof price === 'number' && Number.isFinite(price) ? price : null,
    skus,
  };
}
