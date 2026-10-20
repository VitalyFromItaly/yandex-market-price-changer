import type { Product } from '../../database/schemas/product.schema';
import type { YandexMarketDocument } from '../../database/schemas/yandex-market.schema';
import type { TMarketplace } from '../../shared/marketplace';
import type { TErrorSource } from '../errors/error-reporter.service';
import type {
  IStockPushOrdersInput,
  IStockPushPlan,
  IStockPushProduct,
  IStockPushTargetInput,
  IStockPushTargetPlan,
  TStockPushBlock,
} from '../finance/stock-push';
import type {
  IMarketplaceOrder,
  IMarketplaceStockLevels,
  IMarketplaceStockWriteResult,
  IStockWriteUpdate,
  TStockWriteTarget,
} from '../marketplaces/marketplace-adapter';
import type { TFeatureKey } from '../telegram/bots/shared/features.domain';
import type { TWriteSkipReason } from '../yandex/stocks/stock-upload-policy';

import { Injectable, Logger } from '@nestjs/common';

import { ActionLogService } from '../../database/services/action-log.service';
import { ProductService } from '../../database/services/product.service';
import { YandexMarketService } from '../../database/services/yandex-market.service';
import { MARKETPLACES, MARKETPLACE_LABEL } from '../../shared/marketplace';
import { ErrorReporter } from '../errors/error-reporter.service';
import {
  STOCK_PUSH_BLOCK_TEXT,
  STOCK_PUSH_MAX_ZEROED,
  STOCK_PUSH_ORDERS_WINDOW_DAYS,
  stockPushPlanOf,
} from '../finance/stock-push';
import { MarketplaceNotConnectedError } from '../marketplaces/marketplace-adapter';
import { MarketplaceRegistry } from '../marketplaces/marketplace-registry.service';
import { costDayOf } from '../products/cost-history.domain';
import { FEATURE, isFeatureEnabled } from '../telegram/bots/shared/features.domain';
import { moscowDay, shiftDays } from '../yandex/reports/moscow-day';
import { reportErrorMessage } from '../yandex/reports/report-message';
import { PERIOD } from '../yandex/reports/report-period';
import { placementOfCampaign } from '../yandex/stocks/placement';
import { StockSyncService } from '../yandex/stocks/stock-sync.service';
import { uploadCredentials } from '../yandex/stocks/stock-upload-policy.service';
import { accountStores } from '../yandex/stores/stores.domain';

import { blockAlerts } from './stock-push-alerts';

/** Строка журнала записи — `actionlogs`, рядом с действиями продавца. */
export const STOCK_PUSH_LOG_KIND = 'stock-push';

/** Итог прохода по расписанию (TASK-176) — одна строка на проход. */
export const STOCK_PUSH_SCHEDULE_LOG_KIND = 'stock-push-schedule';

/** Продавец подтверждал другие числа: за время между просмотром и записью что-то изменилось. */
export class StockPushPlanChangedError extends Error {
  readonly userMessage =
    'Остатки изменились после того, как вы смотрели план: пришёл заказ или новый прайс. ' +
    'Обновите план и проверьте его ещё раз — ничего не записано.';

  constructor() {
    super('stock-push: план изменился, запись отменена');
    this.name = 'StockPushPlanChangedError';
  }
}

export interface IStockPushPlanResult {
  plan: IStockPushPlan;
  /** Площадки, которые не спрашивались: не подключены или закрыты фичей. */
  notConsidered: { marketplace: TMarketplace; reason: string }[];
}

export interface IStockPushWriteOutcome {
  marketplace: TMarketplace;
  key: string;
  name: string;
  requested: number;
  written: number;
  errors: { batch: number; message: string }[];
  /** Позиции, которые площадке не отправлялись (WB — несколько размеров). */
  skipped: { sku: string; reason: string }[];
  skipReason?: TWriteSkipReason;
}

/**
 * Фича записи плана на площадку (TASK-175): у каждой площадки своя — это запись
 * в чужой кабинет, и владелец открывает её по продавцу и по площадке.
 */
export const STOCK_PUSH_WRITE_FEATURE: Readonly<Record<TMarketplace, TFeatureKey>> = {
  ym: FEATURE.STOCK_PUSH_WRITE_YM,
  ozon: FEATURE.STOCK_PUSH_WRITE_OZON,
  wb: FEATURE.STOCK_PUSH_WRITE_WB,
};

/** Открыта ли запись хоть на одну площадку — есть ли смысл в кнопке и в apply. */
export function stockPushWriteOpen(features: Readonly<Record<string, boolean>>): boolean {
  return MARKETPLACES.some((marketplace) =>
    isFeatureEnabled(features, STOCK_PUSH_WRITE_FEATURE[marketplace]),
  );
}

/** Площадка → source журнала ошибок: сбой записи — сбой этой площадки. */
const ERROR_SOURCE: Readonly<Record<TMarketplace, TErrorSource>> = {
  ym: 'yandex',
  ozon: 'ozon',
  wb: 'wb',
};

/** Почему функция записи площадки ничего не отправила — строкой журнала прохода. */
const WRITE_SKIP_TEXT: Readonly<Record<TWriteSkipReason, string>> = {
  'write-disabled': 'проверка без записи (STOCK_WRITE_ENABLED=false)',
  placement: 'модель склада не даёт писать остатки',
  'feature-disabled': 'запись закрыта функцией',
};

/** Итог записи любой площадки: у ЯМ причин пропуска больше (фича кампании). */
type TWriteResult = Omit<IMarketplaceStockWriteResult, 'skipReason'> & {
  skipReason?: TWriteSkipReason;
};

/** Ключ цели Ozon/WB с открытой записью: `<площадка>:<id склада>`. */
function writeKeyOf(marketplace: TMarketplace, warehouseId: string): string {
  return `${marketplace}:${warehouseId}`;
}

function warehouseIdOf(key: string): string | null {
  const at = key.indexOf(':');
  return at > 0 && at < key.length - 1 ? key.slice(at + 1) : null;
}

export interface IStockPushApplyResult {
  plan: IStockPushPlan;
  writes: IStockPushWriteOutcome[];
}

/**
 * «Передача остатков» (TASK-143): собирает факты для чистого `stockPushPlanOf`
 * и пишет его итог.
 *
 * ЯМ пишет через `StockSyncService.writeStocks`, Ozon и WB (TASK-175) — через
 * возможность реестра `stockWrite` на единственный FBS-склад продавца; каждая
 * площадка — за своей фичей (`STOCK_PUSH_WRITE_FEATURE`). Площадка с закрытой
 * записью — источник продаж и просмотр «что бы записали». Магазины и площадки
 * опрашиваются по очереди: квоты — на токен.
 */
@Injectable()
export class StockPushService {
  private readonly logger = new Logger(StockPushService.name);
  /** Последние блоки прохода по расписанию: продавец → ключ цели → причина. */
  private readonly scheduleBlocks = new Map<string, Map<string, TStockPushBlock>>();

  constructor(
    private readonly marketplaces: MarketplaceRegistry,
    private readonly products: ProductService,
    private readonly yandexMarket: YandexMarketService,
    private readonly stocks: StockSyncService,
    private readonly actionLog: ActionLogService,
    private readonly errors: ErrorReporter,
  ) {}

  async plan(
    telegramUserId: string,
    features: Readonly<Record<string, boolean>>,
    now: Date = new Date(),
  ): Promise<IStockPushPlanResult> {
    const orders: IStockPushOrdersInput[] = [];
    const targets: IStockPushTargetInput[] = [];
    const notConsidered: IStockPushPlanResult['notConsidered'] = [];

    const doc = await this.yandexMarket.findByTelegramUser(telegramUserId);
    if (doc?.token && doc.campaign_id) {
      await this.ymFacts(doc, now, orders, targets);
    } else {
      notConsidered.push({ marketplace: 'ym', reason: 'магазин не подключён' });
    }

    for (const marketplace of MARKETPLACES) {
      if (marketplace === 'ym') continue;
      const reason = await this.marketplaceFacts(
        telegramUserId,
        marketplace,
        features,
        now,
        orders,
        targets,
      );
      if (reason) notConsidered.push({ marketplace, reason });
    }

    const products = await this.products.findWithPriceListStock(telegramUserId);
    const today = moscowDay(now);
    const oldest = shiftDays(today, -STOCK_PUSH_ORDERS_WINDOW_DAYS);
    const plan = stockPushPlanOf({
      products: products.map(pushProductOf),
      orders,
      targets,
      today: isoOf(today),
      oldestStockDay: isoOf(oldest),
    });
    return { plan, notConsidered };
  }

  /**
   * Запись плана на площадки по кнопке. План пересчитывается здесь же и
   * пишется, только если его отпечаток совпал с тем, что видел продавец.
   */
  async apply(
    telegramUserId: string,
    features: Readonly<Record<string, boolean>>,
    planHash: string,
    now: Date = new Date(),
  ): Promise<IStockPushApplyResult> {
    // Повтор гварда маршрута — барьер не только в доставке (довод writeInBatches).
    if (!stockPushWriteOpen(features)) {
      throw new Error('stock-push: запись закрыта — ни одна фича stock_push_write_* не открыта');
    }
    const { plan } = await this.plan(telegramUserId, features, now);
    if (plan.planHash !== planHash) throw new StockPushPlanChangedError();

    for (const target of plan.targets) {
      if (target.blockedBy === 'zeroing') this.alertZeroing(telegramUserId, target);
    }
    return { plan, writes: await this.write(telegramUserId, features, plan) };
  }

  /**
   * Проход по расписанию (TASK-176): тот же план и та же запись, что у кнопки,
   * но план считается ОДИН раз — сверять отпечаток не с чем, продавец его не
   * видел, а второй пересчёт удвоил бы чтения площадок. Блокировки алертятся
   * при смене состояния (решение `stock_push_schedule_alert_on_change`), итог
   * прохода — строкой журнала `stock-push-schedule`.
   */
  async runScheduled(
    telegramUserId: string,
    features: Readonly<Record<string, boolean>>,
    now: Date = new Date(),
  ): Promise<IStockPushApplyResult> {
    if (!stockPushWriteOpen(features)) {
      throw new Error('stock-push: запись закрыта — ни одна фича stock_push_write_* не открыта');
    }
    const { plan } = await this.plan(telegramUserId, features, now);

    // Цель с закрытой записью проходу не принадлежит: её блок — не сбой расписания.
    const writable = plan.targets.filter((target) =>
      isFeatureEnabled(features, STOCK_PUSH_WRITE_FEATURE[target.marketplace]),
    );
    const memory = this.scheduleBlocks.get(telegramUserId) ?? new Map<string, TStockPushBlock>();
    this.scheduleBlocks.set(telegramUserId, memory);
    for (const target of blockAlerts(memory, writable)) {
      this.alertScheduleBlock(telegramUserId, target);
    }

    const writes = await this.write(telegramUserId, features, plan);
    this.journalPass(telegramUserId, writable, writes);
    return { plan, writes };
  }

  /**
   * Запись готового плана: пишутся цели без блокировки, чья фича записи
   * площадки открыта; env и модель/склад проверяет функция записи площадки сама.
   */
  private async write(
    telegramUserId: string,
    features: Readonly<Record<string, boolean>>,
    plan: IStockPushPlan,
  ): Promise<IStockPushWriteOutcome[]> {
    const doc = await this.yandexMarket.findByTelegramUser(telegramUserId);
    const writes: IStockPushWriteOutcome[] = [];
    for (const target of plan.targets) {
      if (target.blockedBy !== null || !target.updates.length) continue;
      if (!isFeatureEnabled(features, STOCK_PUSH_WRITE_FEATURE[target.marketplace])) continue;

      const updates = target.updates.map((row) => ({ sku: row.sku, count: row.to }));
      const result =
        target.marketplace === 'ym'
          ? await this.writeYm(doc, target.key, updates, telegramUserId)
          : await this.writeMarketplace(telegramUserId, target, updates);
      if (!result) continue;

      const outcome: IStockPushWriteOutcome = {
        marketplace: target.marketplace,
        key: target.key,
        name: target.name,
        requested: updates.length,
        written: result.written,
        errors: result.errors.map(({ batch, message }) => ({ batch, message })),
        skipped: result.skipped,
        ...(result.skipReason ? { skipReason: result.skipReason } : {}),
      };
      writes.push(outcome);
      this.journal(telegramUserId, target, outcome);
      if (outcome.errors.length) {
        void this.errors.report({
          error: new Error(
            `Передача остатков: ${outcome.errors.length} батч(ей) отвергнуто, ` +
              `${MARKETPLACE_LABEL[target.marketplace]} «${target.name}»`,
          ),
          source: ERROR_SOURCE[target.marketplace],
          context: 'stock-push:write',
          telegramUserId,
        });
      }
    }
    return writes;
  }

  /** ЯМ: магазин по кампании, запись — `writeStocks` (env + живая модель внутри). */
  private async writeYm(
    doc: YandexMarketDocument | null,
    campaignId: string,
    updates: IStockWriteUpdate[],
    telegramUserId: string,
  ): Promise<TWriteResult | null> {
    const store = doc
      ? accountStores(doc).find((s) => String(s.campaign_id) === campaignId)
      : undefined;
    const credentials = uploadCredentials(store ?? null);
    if (!credentials) return null;
    const result = await this.stocks.writeStocks(credentials, updates, { telegramUserId });
    return {
      written: result.written,
      errors: result.errors,
      skipped: [],
      ...(result.skipReason ? { skipReason: result.skipReason } : {}),
    };
  }

  /** Ozon/WB: склад из ключа цели, запись — функция записи площадки (барьеры внутри). */
  private async writeMarketplace(
    telegramUserId: string,
    target: IStockPushTargetPlan,
    updates: IStockWriteUpdate[],
  ): Promise<TWriteResult | null> {
    const writer = this.marketplaces.capability(target.marketplace, 'stockWrite');
    const warehouseId = warehouseIdOf(target.key);
    if (!writer || !warehouseId) return null;
    return await writer.writeStocks(
      { telegramUserId, marketplace: target.marketplace },
      warehouseId,
      updates,
    );
  }

  /** ЯМ: каждый магазин кабинета — источник продаж и, если он FBS/DBS, цель записи. */
  private async ymFacts(
    doc: YandexMarketDocument,
    now: Date,
    orders: IStockPushOrdersInput[],
    targets: IStockPushTargetInput[],
  ): Promise<void> {
    const telegramUserId = String(doc.telegramUserId ?? '');
    for (const store of accountStores(doc)) {
      const campaignId = String(store.campaign_id);
      const ref = { telegramUserId, marketplace: 'ym' as const, campaignId };
      const name = store.name ?? `Магазин ${MARKETPLACE_LABEL.ym}`;

      orders.push(await this.readOrders('ym', name, ref, now));

      let available: Record<string, number> | null = null;
      let placement = placementOfCampaign(doc.stores, campaignId) ?? null;
      let error: string | undefined;
      try {
        const levels = await this.marketplaces
          .require('ym', 'stocks', telegramUserId)
          .listStocks(ref, now);
        if (levels.error) error = `остатки недоступны (${levels.error})`;
        else available = sellerAvailable(levels);
        placement = placement ?? levels.placement ?? null;
      } catch (caught) {
        error = reportErrorMessage(caught);
      }
      targets.push({
        marketplace: 'ym',
        key: campaignId,
        name,
        placement: placement ? placement.toUpperCase() : null,
        available,
        canWrite: true,
        ...(error ? { error } : {}),
      });
    }
  }

  /**
   * Ozon/WB: заказы — источник продаж, место «склад продавца» — цель. Пишется
   * она, только если открыта фича записи площадки и метод записи есть; тогда же
   * читается склад записи (единственный FBS). Возвращает причину, если площадка
   * не спрашивалась вовсе: её продаж мы не знаем, и экран обязан это сказать.
   */
  private async marketplaceFacts(
    telegramUserId: string,
    marketplace: TMarketplace,
    features: Readonly<Record<string, boolean>>,
    now: Date,
    orders: IStockPushOrdersInput[],
    targets: IStockPushTargetInput[],
  ): Promise<string | null> {
    const key = marketplace === 'ozon' ? FEATURE.OZON : FEATURE.WB;
    if (!isFeatureEnabled(features, key)) return 'функция площадки закрыта';
    if (!this.marketplaces.capability(marketplace, 'orders')) return 'заказы площадки не читаются';

    const ref = { telegramUserId, marketplace };
    const name = MARKETPLACE_LABEL[marketplace];
    const source = await this.readOrders(marketplace, name, ref, now);
    if (source.orders === null && source.error === NOT_CONNECTED) return 'площадка не подключена';
    orders.push(source);

    let available: Record<string, number> | null = null;
    let error: string | undefined;
    const stocks = this.marketplaces.capability(marketplace, 'stocks');
    if (!stocks) {
      error = 'остатки площадки не читаются';
    } else {
      try {
        const levels = await stocks.listStocks(ref, now);
        if (levels.error) error = `остатки недоступны (${levels.error})`;
        else available = sellerAvailable(levels);
      } catch (caught) {
        error = reportErrorMessage(caught);
      }
    }
    const writer = isFeatureEnabled(features, STOCK_PUSH_WRITE_FEATURE[marketplace])
      ? this.marketplaces.capability(marketplace, 'stockWrite')
      : null;
    let target: TStockWriteTarget | null = null;
    if (writer && !error) {
      try {
        target = await writer.writeTarget(ref);
      } catch (caught) {
        error = `склады продавца не прочитались: ${reportErrorMessage(caught)}`;
        available = null;
      }
    }
    targets.push({
      marketplace,
      key: target?.kind === 'ok' ? writeKeyOf(marketplace, target.warehouse.id) : marketplace,
      name:
        target?.kind === 'ok' && target.warehouse.name
          ? `${name} · ${target.warehouse.name}`
          : name,
      placement: 'FBS',
      available,
      canWrite: !!writer,
      ...(target?.kind === 'none' ? { warehouseBlock: 'no-warehouse' as const } : {}),
      ...(target?.kind === 'several' ? { warehouseBlock: 'several-warehouses' as const } : {}),
      ...(error ? { error } : {}),
    });
    return null;
  }

  private async readOrders(
    marketplace: TMarketplace,
    source: string,
    ref: { telegramUserId: string; marketplace: TMarketplace; campaignId?: string },
    now: Date,
  ): Promise<IStockPushOrdersInput> {
    try {
      const result = await this.marketplaces
        .require(marketplace, 'orders', ref.telegramUserId)
        .listOrders(ref, { key: PERIOD.ALL }, now);
      // Отменённые площадка отдаёт отдельным списком — они не вычитаются.
      return { marketplace, source, orders: result.orders.map(pushOrderOf) };
    } catch (error) {
      if (error instanceof MarketplaceNotConnectedError) {
        return { marketplace, source, orders: null, error: NOT_CONNECTED };
      }
      this.logger.warn(`Заказы ${source} не прочитались: ${String(error)}`);
      return { marketplace, source, orders: null, error: reportErrorMessage(error) };
    }
  }

  private alertZeroing(telegramUserId: string, target: IStockPushTargetPlan): void {
    void this.errors.report({
      error: new Error(
        `Передача остатков остановлена: ${MARKETPLACE_LABEL[target.marketplace]} «${target.name}» ` +
          `обнулил бы ${target.zeroed} ` +
          `позиций (порог ${STOCK_PUSH_MAX_ZEROED})`,
      ),
      source: ERROR_SOURCE[target.marketplace],
      context: 'stock-push:zeroing',
      telegramUserId,
    });
  }

  private alertScheduleBlock(telegramUserId: string, target: IStockPushTargetPlan): void {
    const reason =
      target.blockedBy === 'zeroing'
        ? `обнулил бы ${target.zeroed} позиций (порог ${STOCK_PUSH_MAX_ZEROED})`
        : STOCK_PUSH_BLOCK_TEXT[target.blockedBy];
    void this.errors.report({
      error: new Error(
        `Передача остатков по расписанию остановлена: ${MARKETPLACE_LABEL[target.marketplace]} ` +
          `«${target.name}» — ${reason}${target.error ? ` (${target.error})` : ''}`,
      ),
      source: ERROR_SOURCE[target.marketplace],
      // Площадка в месте ошибки: троттлинг ErrorReporter — по паре «тип + место».
      context: `stock-push:schedule:${target.marketplace}`,
      telegramUserId,
    });
  }

  /** Итог прохода по расписанию — одна строка на проход: по ней карточка «Очередей». */
  private journalPass(
    telegramUserId: string,
    writable: readonly IStockPushTargetPlan[],
    writes: readonly IStockPushWriteOutcome[],
  ): void {
    const requested = writes.reduce((sum, w) => sum + w.requested, 0);
    const written = writes.reduce((sum, w) => sum + w.written, 0);
    const blocked = writable.filter((target) => target.blockedBy !== null);
    const failed = writes.filter((w) => w.errors.length || w.skipReason);
    const parts = [`записано ${written} из ${requested}`];
    if (!writable.some((target) => target.updates.length)) parts.push('менять нечего');
    for (const target of blocked) {
      parts.push(
        `${MARKETPLACE_LABEL[target.marketplace]} «${target.name}»: ${STOCK_PUSH_BLOCK_TEXT[target.blockedBy]}`,
      );
    }
    for (const w of failed) {
      const label = `${MARKETPLACE_LABEL[w.marketplace]} «${w.name}»`;
      if (w.skipReason)
        parts.push(`${label}: ${WRITE_SKIP_TEXT[w.skipReason]}, позиций ${w.requested}`);
      if (w.errors.length) parts.push(`${label}: отвергнуто батчей ${w.errors.length}`);
    }
    void this.actionLog.record({
      telegramUserId,
      botId: 'schedule',
      direction: 'out',
      kind: STOCK_PUSH_SCHEDULE_LOG_KIND,
      action: `передача остатков по расписанию: ${parts.join('; ')}`,
      status: blocked.length || failed.length ? 'error' : 'ok',
      context: 'stock-push:schedule',
      details: {
        requested,
        written,
        blocked: blocked.map((target) => `${target.key}=${target.blockedBy}`).join(', '),
        failedTargets: failed.length,
      },
    });
  }

  private journal(
    telegramUserId: string,
    target: IStockPushTargetPlan,
    outcome: IStockPushWriteOutcome,
  ): void {
    void this.actionLog.record({
      telegramUserId,
      botId: 'crm',
      direction: 'out',
      kind: STOCK_PUSH_LOG_KIND,
      action:
        `передача остатков в ${MARKETPLACE_LABEL[target.marketplace]} «${target.name}»: ` +
        `записано ${outcome.written} из ${outcome.requested}`,
      status: outcome.errors.length || outcome.skipReason ? 'error' : 'ok',
      ...(outcome.skipReason ? { error: `запись пропущена: ${outcome.skipReason}` } : {}),
      context: `stock-push:${target.key}`,
      details: {
        marketplace: target.marketplace,
        campaign: target.key,
        requested: outcome.requested,
        skipped: outcome.skipped.length,
        written: outcome.written,
        zeroed: target.zeroed,
        failedBatches: outcome.errors.length,
      },
    });
  }
}

const NOT_CONNECTED = 'not-connected';

function sellerAvailable(levels: IMarketplaceStockLevels): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [sku, amount] of Object.entries(levels.byLocation.seller ?? {})) {
    result[sku] = amount.available;
  }
  return result;
}

function pushOrderOf(order: IMarketplaceOrder): IStockPushOrdersInput['orders'][number] {
  return {
    scheme: order.scheme,
    stage: order.stage,
    createdDay: order.createdDay,
    items: order.items.map((item) => ({ sku: item.sku, count: item.count })),
  };
}

function pushProductOf(product: Product): IStockPushProduct {
  const skus: IStockPushProduct['skus'] = {};
  for (const marketplace of MARKETPLACES) {
    const sku = product.marketplaceSkus?.[marketplace];
    if (sku) skus[marketplace] = sku;
  }
  return {
    id: String((product as { _id?: unknown })._id),
    internalSku: product.internalSku,
    name: product.name ?? null,
    stock: typeof product.stock === 'number' ? product.stock : null,
    stockDay: costDayOf(product.stockUpdatedAt ?? null),
    skus,
  };
}

function isoOf(day: { year: number; month: number; day: number }): string {
  return `${day.year}-${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`;
}
