import type {
  IInventoryColumn,
  IInventoryProblem,
  IInventorySnapshot,
  TInventoryColumnState,
} from './inventory.domain';
import type { Product } from '../../database/schemas/product.schema';
import type { YandexMarketDocument } from '../../database/schemas/yandex-market.schema';
import type { TMarketplace } from '../../shared/marketplace';
import type { TOrderStage } from '../../shared/order-stage';
import type {
  IInventoryAmount,
  IInventoryLevels,
  IInventoryMarketplaceInput,
  IInventoryProduct,
} from '../finance/inventory';
import type { IMarketplaceStockLevels } from '../marketplaces/marketplace-adapter';
import type { TFeatureMap } from '../telegram/bots/shared/features.domain';

import { Injectable } from '@nestjs/common';

import { ProductService } from '../../database/services/product.service';
import { MARKETPLACES, MARKETPLACE_LABEL } from '../../shared/marketplace';
import { withoutIcon } from '../crm/jobs/crm-jobs.domain';
import { financeToday } from '../finance/finance-period';
import { FinanceService } from '../finance/finance.service';
import { forecastPlan } from '../finance/forecast';
import { inventoryOf } from '../finance/inventory';
import { MarketplaceNotConnectedError } from '../marketplaces/marketplace-adapter';
import { isMarketplaceFeatureOpen } from '../marketplaces/marketplace-connections.domain';
import { MarketplaceRegistry } from '../marketplaces/marketplace-registry.service';
import { ymStocks } from '../marketplaces/ym-stocks';
import { ProductCatalogService } from '../products/product-catalog.service';
import {
  FEATURE,
  REPORT_TO_FEATURE,
  isFeatureEnabled,
} from '../telegram/bots/shared/features.domain';
import { fbyStockUnavailableLine } from '../yandex/fby/fby-message';
import { OrderReportsService } from '../yandex/reports/order-reports.service';
import { reportErrorMessage } from '../yandex/reports/report-message';
import { DEFAULT_PERIOD, PERIOD } from '../yandex/reports/report-period';
import { REPORT } from '../yandex/reports/report-status-map';
import { accountStores } from '../yandex/stores/stores.domain';

import {
  INVENTORY_BASIS_DAYS,
  INVENTORY_PLACE_LABEL,
  MARKETPLACE_ORDERS_WINDOW_NOTE,
  NOT_CONNECTED_TEXT,
  NO_JOURNAL_TEXT,
  OZON_RETURNS_UNAVAILABLE_TEXT,
  WB_TRANSIT_NOTE,
  YM_REPORT_CLOSED_TEXT,
} from './inventory.domain';

/** «В пути к покупателю» по общему этапу заказа — тот же срез, что «Едет до клиента» ЯМ. */
const IN_TRANSIT_STAGES: ReadonlySet<TOrderStage> = new Set<TOrderStage>([
  'handed_over',
  'in_transit',
  'delivered',
]);

/** Что собрано о площадке, кроме скорости продаж. */
interface IMarketplaceFacts {
  input: IInventoryMarketplaceInput;
  column: IInventoryColumn;
}

/** Что нужно сборке: продавец, его магазин (все магазины кабинета) и фичи. */
export interface IInventoryBuildInput {
  telegramUserId: string;
  store: YandexMarketDocument | null;
  features: TFeatureMap;
  now: Date;
  /**
   * Собирать ли «в пути» и возвраты: отчёты ЯМ «Едет до клиента / обратно» и
   * заказы Ozon/WB — самая дорогая часть. Разделу «Склад» нужны, правилам
   * уведомлений — нет.
   */
  movements: boolean;
}

/**
 * Сборка склада (TASK-142; вынесена из CRM-kind-а в TASK-152, чтобы те же числа
 * читали правила уведомлений). Только чтение: остатки — возможность `stocks`
 * реестра (FBY ЯМ внутри адаптера идёт через `FbyStockService`, лимит генерации
 * отчёта держит он), в пути и возвраты ЯМ — отчёты «Едет до клиента» / «Едет
 * обратно» (решение `inventory_transit_ym_reports_mp_orders`), Ozon/WB — их
 * заказы, скорость — финжурнал площадки (`inventory_speed_from_journal`), свой
 * склад — `Product.stock` из прайса. Магазины и площадки — по очереди (квоты на
 * токен), сбой каждой — строка с причиной, а не ноль.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly marketplaces: MarketplaceRegistry,
    private readonly reports: OrderReportsService,
    private readonly finance: FinanceService,
    private readonly products: ProductService,
    private readonly catalog: ProductCatalogService,
  ) {}

  async build(input: IInventoryBuildInput): Promise<IInventorySnapshot> {
    const { telegramUserId, features, now } = input;
    const problems: IInventoryProblem[] = [];
    const notes: string[] = [];

    const open = MARKETPLACES.filter(
      (marketplace) =>
        isMarketplaceFeatureOpen(features, marketplace) &&
        this.marketplaces.capability(marketplace, 'stocks') !== null,
    );

    const facts: IMarketplaceFacts[] = [];
    for (const marketplace of open) {
      facts.push(
        marketplace === 'ym'
          ? await this.ymFacts(input, problems, notes)
          : await this.marketplaceFacts(input, marketplace, problems),
      );
    }
    if (input.movements) {
      if (open.some((marketplace) => marketplace !== 'ym'))
        notes.push(MARKETPLACE_ORDERS_WINDOW_NOTE);
      if (open.includes('ozon')) notes.push(OZON_RETURNS_UNAVAILABLE_TEXT);
      if (open.includes('wb')) notes.push(WB_TRANSIT_NOTE);
    }

    const journals = await this.journalUnits(telegramUserId, open, now, problems);
    const products = await this.loadProducts(telegramUserId, facts, journals);

    for (const fact of facts) {
      fact.input.sold = soldByProduct(
        fact.input.marketplace,
        journals.get(fact.input.marketplace),
        products,
      );
    }

    const costs = await this.catalog.costsFor(
      telegramUserId,
      products.map((product) => ({
        id: idOf(product),
        name: product.name,
        category: product.category,
        purchase: product.purchase ?? null,
      })),
      now,
    );

    const inventory = inventoryOf(
      products.map((product) => inventoryProductOf(product, costs.get(idOf(product)) ?? null)),
      facts.map((fact) => fact.input),
      INVENTORY_BASIS_DAYS,
    );

    return { inventory, columns: facts.map((fact) => fact.column), problems, notes };
  }

  /** ЯМ: остатки, в пути и возвраты по всем магазинам кабинета, по очереди. */
  private async ymFacts(
    { store: account, features, now, movements }: IInventoryBuildInput,
    problems: IInventoryProblem[],
    notes: string[],
  ): Promise<IMarketplaceFacts> {
    const transitOpen =
      movements && isFeatureEnabled(features, REPORT_TO_FEATURE[REPORT.IN_TRANSIT]);
    const returningOpen =
      movements && isFeatureEnabled(features, REPORT_TO_FEATURE[REPORT.RETURNING]);
    const deepHistory = isFeatureEnabled(features, FEATURE.DEEP_HISTORY);
    if (movements && !transitOpen) notes.push(YM_REPORT_CLOSED_TEXT('Едет до клиента'));
    if (movements && !returningOpen) notes.push(YM_REPORT_CLOSED_TEXT('Едет обратно'));

    let levels: IInventoryLevels | null = null;
    let takenAt: Date | null = null;
    const inTransit = transitOpen ? new Map<string, number>() : null;
    const returning = returningOpen ? new Map<string, number>() : null;

    for (const store of account ? accountStores(account) : []) {
      const storeName = store.name ?? '';
      try {
        const stocks = await ymStocks(this.marketplaces, store, now);
        if (stocks.error) {
          problems.push({
            marketplace: 'ym',
            storeName,
            problem: withoutIcon(fbyStockUnavailableLine(stocks.error)),
          });
        } else {
          levels = mergeLevels(levels, stocks);
          if (stocks.takenAt && (!takenAt || stocks.takenAt > takenAt)) takenAt = stocks.takenAt;
        }
        if (inTransit) {
          const report = await this.reports.build(store, REPORT.IN_TRANSIT, now, DEFAULT_PERIOD, {
            deepHistory,
          });
          for (const order of report.orders) addItems(inTransit, order.items);
        }
        if (returning) {
          const report = await this.reports.build(
            store,
            REPORT.RETURNING,
            now,
            { key: PERIOD.ALL },
            { deepHistory },
          );
          for (const order of report.orders) addItems(returning, order.items);
          for (const record of report.returns?.records ?? []) addItems(returning, record.items);
        }
      } catch (error) {
        problems.push({ marketplace: 'ym', storeName, problem: reportErrorMessage(error) });
      }
    }

    return {
      input: { marketplace: 'ym', levels, inTransit, returning, sold: null },
      column: columnOf('ym', 'ok', takenAt, levels),
    };
  }

  /** Ozon/WB: остатки и заказы последних 30 дней через реестр. */
  private async marketplaceFacts(
    { telegramUserId, now, movements }: IInventoryBuildInput,
    marketplace: TMarketplace,
    problems: IInventoryProblem[],
  ): Promise<IMarketplaceFacts> {
    const ref = { telegramUserId, marketplace };
    const empty: IInventoryMarketplaceInput = {
      marketplace,
      levels: null,
      inTransit: null,
      returning: null,
      sold: null,
    };

    let levels: IInventoryLevels | null = null;
    let takenAt: Date | null = null;
    try {
      const stocks = await this.marketplaces
        .require(marketplace, 'stocks', telegramUserId)
        .listStocks(ref, now);
      if (stocks.error) {
        problems.push({
          marketplace,
          storeName: null,
          problem: withoutIcon(fbyStockUnavailableLine(stocks.error)),
        });
      } else {
        levels = mergeLevels(null, stocks);
        takenAt = stocks.takenAt;
      }
    } catch (error) {
      if (error instanceof MarketplaceNotConnectedError) {
        problems.push({ marketplace, storeName: null, problem: NOT_CONNECTED_TEXT(marketplace) });
        return { input: empty, column: columnOf(marketplace, 'not-connected', null, null) };
      }
      problems.push({ marketplace, storeName: null, problem: reportErrorMessage(error) });
    }

    let inTransit: Map<string, number> | null = null;
    let returning: Map<string, number> | null = null;
    const source = movements ? this.marketplaces.capability(marketplace, 'orders') : null;
    if (source) {
      try {
        const { orders } = await source.listOrders(ref, { key: PERIOD.ALL }, now);
        inTransit = new Map();
        returning = marketplace === 'ozon' ? null : new Map();
        for (const order of orders) {
          if (IN_TRANSIT_STAGES.has(order.stage)) addItems(inTransit, order.items);
          else if (order.stage === 'returning' && returning) addItems(returning, order.items);
        }
      } catch (error) {
        problems.push({ marketplace, storeName: null, problem: reportErrorMessage(error) });
      }
    }

    return {
      input: { ...empty, levels, inTransit, returning },
      column: columnOf(marketplace, 'ok', takenAt, levels),
    };
  }

  /**
   * Штуки за окно скорости из журнала площадки (`pnl.skus`, продано минус
   * вернулось) — ключ закупа строки журнала. Месяц окна не загружен — скорость
   * этой площадки не считается вовсе: половина окна дала бы половину скорости.
   */
  private async journalUnits(
    telegramUserId: string,
    open: readonly TMarketplace[],
    now: Date,
    problems: IInventoryProblem[],
  ): Promise<Map<TMarketplace, Map<string, number>>> {
    const plan = forecastPlan(financeToday(now), INVENTORY_BASIS_DAYS);
    const result = new Map<TMarketplace, Map<string, number>>();
    for (const marketplace of open) {
      try {
        const report = await this.finance.build(telegramUserId, plan.basis, now, {
          flat: false,
          marketplace,
        });
        const missing = report.months.find((month) => month.status === null);
        if (missing) {
          const month = `${missing.from.slice(5, 7)}.${missing.from.slice(0, 4)}`;
          problems.push({
            marketplace,
            storeName: null,
            problem: NO_JOURNAL_TEXT(marketplace, month),
          });
          continue;
        }
        const units = new Map<string, number>();
        for (const sku of report.pnl.skus.skus) {
          units.set(sku.sku, (units.get(sku.sku) ?? 0) + sku.units);
        }
        result.set(marketplace, units);
      } catch (error) {
        problems.push({
          marketplace,
          storeName: null,
          problem: `Скорость продаж ${MARKETPLACE_LABEL[marketplace]} не посчитана: ${reportErrorMessage(error)}`,
        });
      }
    }
    return result;
  }

  /**
   * Товары, о которых есть что сказать: с остатком, в пути или возвратом на
   * площадке, с продажами в журнале или со своим складом. Журнал Ozon/WB несёт
   * ключ закупа — артикул ЯМ товара или, без него, артикул площадки.
   */
  private async loadProducts(
    telegramUserId: string,
    facts: readonly IMarketplaceFacts[],
    journals: ReadonlyMap<TMarketplace, ReadonlyMap<string, number>>,
  ): Promise<Product[]> {
    const byId = new Map<string, Product>();
    const add = (products: readonly Product[]) => {
      for (const product of products) byId.set(idOf(product), product);
    };

    for (const { input } of facts) {
      const skus = new Set<string>([
        ...Object.keys(input.levels?.seller ?? {}),
        ...Object.keys(input.levels?.marketplace ?? {}),
        ...(input.inTransit?.keys() ?? []),
        ...(input.returning?.keys() ?? []),
        ...(journals.get(input.marketplace)?.keys() ?? []),
      ]);
      add(await this.products.findByMarketplaceSkus(telegramUserId, input.marketplace, [...skus]));
    }
    const journalSkus = new Set<string>();
    for (const units of journals.values()) for (const sku of units.keys()) journalSkus.add(sku);
    add(await this.products.findByYmSkus(telegramUserId, [...journalSkus]));
    add(await this.products.findWithOwnStock(telegramUserId));
    return [...byId.values()];
  }
}

function idOf(product: Product): string {
  return String((product as { _id?: unknown })._id);
}

function inventoryProductOf(product: Product, costRub: number | null): IInventoryProduct {
  const skus: Partial<Record<TMarketplace, string>> = {};
  for (const marketplace of MARKETPLACES) {
    const sku = product.marketplaceSkus?.[marketplace];
    if (sku) skus[marketplace] = sku;
  }
  return {
    id: idOf(product),
    internalSku: product.internalSku,
    name: product.name ?? null,
    skus,
    ownStock: typeof product.stock === 'number' ? product.stock : null,
    ownStockAt: product.stockUpdatedAt ?? null,
    costRub,
  };
}

/**
 * Журнал площадки → штуки по id товара. Ключ строки — ключ закупа: сначала
 * товар по артикулу ЯМ, потом по артикулу этой площадки (так его ставит импорт
 * Ozon/WB). Не нашёлся — строка не относится ни к одному товару склада.
 */
function soldByProduct(
  marketplace: TMarketplace,
  units: ReadonlyMap<string, number> | undefined,
  products: readonly Product[],
): Map<string, number> | null {
  if (!units) return null;
  const byYm = new Map<string, string>();
  const byOwn = new Map<string, string>();
  for (const product of products) {
    const ym = product.marketplaceSkus?.ym;
    const own = product.marketplaceSkus?.[marketplace];
    if (ym) byYm.set(ym, idOf(product));
    if (own) byOwn.set(own, idOf(product));
  }
  const sold = new Map<string, number>();
  for (const [sku, count] of units) {
    const id = byYm.get(sku) ?? byOwn.get(sku);
    if (id) sold.set(id, (sold.get(id) ?? 0) + count);
  }
  return sold;
}

/** Остатки магазинов одной площадки складываются по месту, места между собой — никогда. */
function mergeLevels(
  into: IInventoryLevels | null,
  levels: IMarketplaceStockLevels,
): IInventoryLevels {
  const result: IInventoryLevels = into ?? {};
  for (const place of ['seller', 'marketplace'] as const) {
    const source = levels.byLocation[place];
    if (!source) continue;
    const target = (result[place] ??= {});
    for (const [sku, amount] of Object.entries(source)) {
      const prev: IInventoryAmount | undefined = target[sku];
      target[sku] = {
        available: (prev?.available ?? 0) + amount.available,
        reserved: prev ? addNullable(prev.reserved, amount.reserved) : amount.reserved,
      };
    }
  }
  return result;
}

function addNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

function addItems(
  target: Map<string, number>,
  items: readonly { offerId?: string; sku?: string; count?: number }[] | undefined,
): void {
  for (const item of items ?? []) {
    const sku = (item.offerId ?? item.sku)?.trim();
    const count = Number(item.count ?? 0);
    if (!sku || !(count > 0)) continue;
    target.set(sku, (target.get(sku) ?? 0) + count);
  }
}

function columnOf(
  marketplace: TMarketplace,
  state: TInventoryColumnState,
  takenAt: Date | null,
  levels: IInventoryLevels | null,
): IInventoryColumn {
  const amounts = [
    ...Object.values(levels?.seller ?? {}),
    ...Object.values(levels?.marketplace ?? {}),
  ];
  return {
    marketplace,
    label: MARKETPLACE_LABEL[marketplace],
    state,
    places: { ...INVENTORY_PLACE_LABEL[marketplace] },
    takenAt: takenAt ? takenAt.toISOString() : null,
    hasReserve: amounts.some((amount) => amount.reserved !== null),
  };
}
