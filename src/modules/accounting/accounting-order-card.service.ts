import type { TAccountingCostMethod } from './accounting-lots.domain';
import type {
  IAccountingOrderCard,
  IAccountingOrdersFilter,
  IAccountingOrdersList,
  IOrderCardOperation,
} from './accounting-order-card.domain';
import type { IAccountingOrderLineInput } from './accounting-order-lines.domain';
import type { TOrderReconcileState } from './accounting-reconcile.domain';
import type { IOrderProfit, TOrderForecastOf } from './order-profit-state';
import type { IOrderResult, TOrderCostOf, TOrderLotCostOf, TOrderUnitCost } from './order-result';
import type { IStoreCostItem } from './store-cost-allocation';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { TAccountingOrderLineRow } from '../../database/postgres/repositories/accounting-order-line.repository';
import type { IOrderResultSnapshotWrite } from '../../database/postgres/repositories/accounting-order-result.repository';
import type { YandexMarketDocument } from '../../database/schemas/yandex-market.schema';
import type { IFinancePeriod } from '../finance/finance-period';
import type { ICalcSku } from '../finance/price-calc-rates';

import { Injectable } from '@nestjs/common';

import { AccountingOrderLineRepository } from '../../database/postgres/repositories/accounting-order-line.repository';
import { AccountingOrderResultRepository } from '../../database/postgres/repositories/accounting-order-result.repository';
import { FinanceOperationRepository } from '../../database/postgres/repositories/finance-operation.repository';
import { monthsOf } from '../finance/finance-period';
import { PriceCalcRatesService } from '../finance/price-calc-rates.service';

import { AccountingCogsService } from './accounting-cogs.service';
import { inDashboardPeriod, orderCreatedOn } from './accounting-dashboard.domain';
import { AccountingManualOperationsService } from './accounting-manual-operations.service';
import {
  allocationOrderOf,
  filterOrdersRows,
  groupLinesByOrder,
  journalOperationOf,
  manualOperationOf,
  mergeAllocations,
  orderCardOf,
  orderKeyOf,
  orderMonthOf,
  ordersRowOf,
  ordersTotalsOf,
  storeCostItemOf,
} from './accounting-order-card.domain';
import { lineValueOf } from './accounting-order-lines.domain';
import { orderReconcileStateOf } from './accounting-reconcile.domain';
import { AccountingReconcileService } from './accounting-reconcile.service';
import { AccountingStoreCostsService } from './accounting-store-costs.service';
import { AccountingTaxService } from './accounting-tax.service';
import { AccountingService } from './accounting.service';
import { allocateBoundExpenses, expenseCostItemOf } from './expense-binding-allocation';
import { orderForecastRatesOf, orderProfitStateOf } from './order-profit-state';
import { ORDER_RESULT_KEY_OF_ARTICLE, orderResultOf } from './order-result';
import { ALLOCATION_METHOD_TITLE, allocateStoreCosts } from './store-cost-allocation';

/** Заказа нет у продавца (или он из другого магазина, чем открыт в вебе). */
export class AccountingOrderNotFoundError extends Error {
  constructor() {
    super('Заказ не найден');
    this.name = 'AccountingOrderNotFoundError';
  }
}

const DAY_MS = 86_400_000;
const moscowStart = (day: string) => new Date(`${day}T00:00:00+03:00`);

type TFeatures = Readonly<Record<string, boolean>>;

function lineInputOf(row: TAccountingOrderLineRow): IAccountingOrderLineInput {
  return {
    ...lineValueOf(row),
    marketplace: row.marketplace,
    orderId: row.orderId,
    itemId: row.itemId,
  };
}

/** Заказ виден в магазине из URL: ЯМ — своей кампании; Ozon/WB — без магазина. */
function inStore(lines: readonly IAccountingOrderLineInput[], store: YandexMarketDocument | null) {
  const line = lines[0];
  if (line.marketplace !== 'ym') return true;
  return (
    Boolean(store?.campaign_id) && lines.some((l) => l.campaignId === String(store.campaign_id))
  );
}

/** Посчитанный заказ месяца — то же, из чего собрана его карточка (панель TASK-229). */
export interface IComputedOrder {
  key: string;
  marketplace: TFinanceMarketplace;
  orderId: string;
  lines: IAccountingOrderLineInput[];
  operations: IOrderCardOperation[];
  result: IOrderResult;
  profit: IOrderProfit;
  costOf: TOrderCostOf;
  lotCostOf?: TOrderLotCostOf;
  snapshot: IOrderResultSnapshotWrite;
}

interface IComputedMonth {
  marketplaces: TFinanceMarketplace[];
  methodTitle: string;
  cogsMethod: TAccountingCostMethod;
  orders: IComputedOrder[];
  unallocatedKopecks: number;
}

/**
 * Карточка и список заказов «Финучёта» (TASK-222): собирает вход из реестра и
 * зовёт `orderResultOf` → `orderProfitStateOf` → `recordSnapshot`. Своих формул
 * нет: прибыль — ядро TASK-217/218, распределение — `allocateStoreCosts`,
 * налог — `AccountingTaxService.orderTaxItem`, закуп — `AccountingCogsService`.
 * Текущий механизм (`pnl.ts`, «Лента заказов») не зовётся и не меняется.
 */
@Injectable()
export class AccountingOrderCardService {
  constructor(
    private readonly accounting: AccountingService,
    private readonly orderLines: AccountingOrderLineRepository,
    private readonly operations: FinanceOperationRepository,
    private readonly manual: AccountingManualOperationsService,
    private readonly storeCosts: AccountingStoreCostsService,
    private readonly tax: AccountingTaxService,
    private readonly cogs: AccountingCogsService,
    private readonly reconcile: AccountingReconcileService,
    private readonly priceCalc: PriceCalcRatesService,
    private readonly results: AccountingOrderResultRepository,
  ) {}

  /** Карточка одного заказа с раскрытием каждой суммы до операций. */
  async order(
    telegramUserId: string,
    features: TFeatures,
    store: YandexMarketDocument | null,
    target: { marketplace: TFinanceMarketplace; orderId: string },
    now: Date = new Date(),
  ): Promise<IAccountingOrderCard> {
    const marketplaces = await this.accounting.marketplacesOf(telegramUserId, features);
    if (!marketplaces.includes(target.marketplace)) throw new AccountingOrderNotFoundError();
    const rows = await this.orderLines.linesOf(telegramUserId, target.orderId, target.marketplace);
    const lines = rows.map(lineInputOf);
    if (!lines.length || !inStore(lines, store)) throw new AccountingOrderNotFoundError();
    const month = orderMonthOf(lines);
    if (!month) throw new AccountingOrderNotFoundError();

    const key = orderKeyOf(target.marketplace, target.orderId);
    const computed = await this.computeMonth(
      telegramUserId,
      features,
      store,
      month,
      marketplaces,
      now,
      {
        onlyKey: key,
      },
    );
    const order = computed.orders.find((o) => o.key === key);
    if (!order) throw new AccountingOrderNotFoundError();

    const versions = await this.results.versionsOf(telegramUserId, {
      marketplace: order.marketplace,
      orderId: order.orderId,
    });
    return orderCardOf({
      marketplace: order.marketplace,
      orderId: order.orderId,
      profit: order.profit,
      referenceIds: order.result.referenceOperationIds,
      lines: order.lines,
      operations: order.operations,
      keyOfArticle: (op) => ORDER_RESULT_KEY_OF_ARTICLE[op.article],
      costOf: order.costOf,
      lotCostOf: order.lotCostOf,
      cogsMethod: order.result.costMethod,
      prices: order.result.prices,
      costMethod: computed.methodTitle,
      allocationPeriod: month,
      snapshot: order.snapshot,
      versions: versions.map((v) => ({
        version: v.version,
        state: v.state,
        reason: v.reason,
        netKopecks: (v.value as IOrderProfit | null)?.netKopecks ?? null,
        capturedAt: v.capturedAt,
      })),
    });
  }

  /** Заказы месяца оформления с фильтрами площадки, состояния и «только убыточные». */
  async orders(
    telegramUserId: string,
    features: TFeatures,
    store: YandexMarketDocument | null,
    month: IFinancePeriod,
    filter: IAccountingOrdersFilter = {},
    now: Date = new Date(),
  ): Promise<IAccountingOrdersList> {
    const marketplaces = await this.accounting.marketplacesOf(telegramUserId, features);
    const computed = await this.computeMonth(
      telegramUserId,
      features,
      store,
      month,
      marketplaces,
      now,
      {
        marketplace: filter.marketplace ?? null,
      },
    );
    const rows = filterOrdersRows(
      computed.orders.map((o) =>
        ordersRowOf({
          marketplace: o.marketplace,
          orderId: o.orderId,
          lines: o.lines,
          profit: o.profit,
        }),
      ),
      filter,
    );
    return {
      period: month,
      costMethod: computed.methodTitle,
      cogsMethod: computed.cogsMethod,
      marketplaces,
      rows,
      totals: ordersTotalsOf(rows),
      unallocatedKopecks: computed.unallocatedKopecks,
    };
  }

  /**
   * Заказы месяца оформления, посчитанные так же, как их карточки (панель
   * «Финучёта», TASK-229): та же база распределения, налог и снимки. `onlyKeys` —
   * только эти заказы (ключ `orderKeyOf`); площадки — открытые продавцу.
   */
  async periodOrders(
    telegramUserId: string,
    features: TFeatures,
    store: YandexMarketDocument | null,
    month: IFinancePeriod,
    scope: { onlyKeys?: readonly string[]; marketplace?: TFinanceMarketplace | null } = {},
    now: Date = new Date(),
  ): Promise<IComputedOrder[]> {
    const marketplaces = await this.accounting.marketplacesOf(telegramUserId, features);
    const computed = await this.computeMonth(
      telegramUserId,
      features,
      store,
      month,
      marketplaces,
      now,
      {
        onlyKeys: scope.onlyKeys ? new Set(scope.onlyKeys) : undefined,
        marketplace: scope.marketplace,
      },
    );
    return computed.orders;
  }

  /**
   * Заказы, оформленные в днях периода: карточки каждого задетого месяца
   * оформления, отфильтрованные по дню оформления. Одно правило для базиса
   * «продажа» панели (TASK-229) и аналитики (TASK-230).
   */
  async ordersCreatedIn(
    telegramUserId: string,
    features: TFeatures,
    store: YandexMarketDocument | null,
    period: IFinancePeriod,
    marketplace: TFinanceMarketplace | null = null,
    now: Date = new Date(),
  ): Promise<IComputedOrder[]> {
    const orders: IComputedOrder[] = [];
    for (const month of monthsOf(period)) {
      const computed = await this.periodOrders(
        telegramUserId,
        features,
        store,
        month,
        { marketplace },
        now,
      );
      orders.push(...computed.filter((o) => inDashboardPeriod(orderCreatedOn(o.lines), period)));
    }
    return orders;
  }

  /**
   * Месяц оформления: база распределения — все заказы месяца аккаунта, карточки —
   * только заказы магазина из URL (и `onlyKey`/`onlyKeys`/`marketplace`, если заданы).
   */
  private async computeMonth(
    telegramUserId: string,
    features: TFeatures,
    store: YandexMarketDocument | null,
    month: IFinancePeriod,
    marketplaces: TFinanceMarketplace[],
    now: Date,
    scope: {
      onlyKey?: string;
      onlyKeys?: ReadonlySet<string>;
      marketplace?: TFinanceMarketplace | null;
    },
  ): Promise<IComputedMonth> {
    const from = moscowStart(month.from);
    const to = new Date(moscowStart(month.to).getTime() + DAY_MS);

    const [monthRows, manualRows, method, taxItem, lotCostOf, expenses] = await Promise.all([
      this.orderLines.linesCreatedBetween(telegramUserId, month.from, month.to, marketplaces),
      this.manual.list(telegramUserId),
      this.storeCosts.methodOf(telegramUserId),
      this.tax.orderTaxItem(telegramUserId, features, month),
      // Режим Б — одно FIFO на все площадки: склад общий, считается с нуля.
      this.cogs.lotCostOf(telegramUserId, features),
      this.storeCosts.expensesOf(telegramUserId, month),
    ]);
    const cogsMethod: TAccountingCostMethod = lotCostOf ? 'lot_fifo' : 'historical_price';
    const byOrder = groupLinesByOrder(monthRows.map(lineInputOf));
    const enabled = new Set(marketplaces);
    const manualOps = manualRows
      .filter((row) => enabled.has(row.marketplace))
      .map((row) => manualOperationOf(row));

    // ── Распределение: по площадке — реклама и общие расходы, налог — по всем ──
    const allocationParts = [];
    let unallocatedKopecks = 0;
    for (const marketplace of marketplaces) {
      const journal = await this.operations.liveStoreLevelBetween(
        telegramUserId,
        from,
        to,
        marketplace,
      );
      const items: IStoreCostItem[] = [
        ...journal.map((op) => storeCostItemOf(journalOperationOf(op, marketplace, null))),
        ...manualOps
          .filter(
            (op) =>
              op.marketplace === marketplace &&
              !op.orderId &&
              op.accruedAt >= from &&
              op.accruedAt < to,
          )
          .map(storeCostItemOf),
        ...expenses.storeLevel
          .filter((e) => e.row.scope === 'marketplace' && e.row.marketplace === marketplace)
          .map((e) => expenseCostItemOf(e, expenses.titleOf(e))),
      ];
      const orders = [...byOrder]
        .filter(([key]) => key.startsWith(`${marketplace}|`))
        .map(([key, lines]) => allocationOrderOf(key, lines));
      const allocation = allocateStoreCosts({ method, orders, items });
      allocationParts.push(allocation.byOrder);
      unallocatedKopecks += allocation.unallocated.totalKopecks;
    }
    // Расходы всего бизнеса (и записи до v2) — по всем заказам месяца, как налог.
    const businessItems = expenses.storeLevel
      .filter((e) => e.row.scope !== 'marketplace')
      .map((e) => expenseCostItemOf(e, expenses.titleOf(e)));
    if (businessItems.length) {
      const allocation = allocateStoreCosts({
        method,
        orders: [...byOrder].map(([key, lines]) => allocationOrderOf(key, lines)),
        items: businessItems,
      });
      allocationParts.push(allocation.byOrder);
      unallocatedKopecks += allocation.unallocated.totalKopecks;
    }
    // Расходы заказа и товара — «Прочие расходы» своих заказов.
    const bound = allocateBoundExpenses({
      byOrder: new Map([...byOrder].filter(([, lines]) => enabled.has(lines[0].marketplace))),
      expenses: expenses.bound,
      titleOf: expenses.titleOf,
    });
    allocationParts.push(bound.byOrder);
    unallocatedKopecks += bound.unallocated.totalKopecks;
    if (taxItem) {
      const allocation = allocateStoreCosts({
        method,
        orders: [...byOrder].map(([key, lines]) => allocationOrderOf(key, lines)),
        items: [taxItem],
      });
      allocationParts.push(allocation.byOrder);
      unallocatedKopecks += allocation.unallocated.totalKopecks;
    }
    const allocations = mergeAllocations(allocationParts);

    // ── Заказы в выдаче ──
    const inScope = [...byOrder].filter(
      ([key, lines]) =>
        (!scope.onlyKey || key === scope.onlyKey) &&
        (!scope.onlyKeys || scope.onlyKeys.has(key)) &&
        (!scope.marketplace || lines[0].marketplace === scope.marketplace) &&
        inStore(lines, store),
    );

    const computed: IComputedOrder[] = [];
    const scopeMarketplaces = [...new Set(inScope.map(([, lines]) => lines[0].marketplace))];
    // Сверка — один раз на площадку; у WB документа нет (итог всегда insufficient_data) — не зовём.
    const reconcileMarketplaces = scopeMarketplaces.filter((m) => m !== 'wb');
    const [forecastOf, reconcilers] = await Promise.all([
      scopeMarketplaces.includes('ym') ? this.ymForecast(telegramUserId, store, now) : null,
      Promise.all(
        reconcileMarketplaces.map((m) => this.reconcileOf(telegramUserId, month, now, m)),
      ),
    ]);
    const reconcileOf = new Map(reconcileMarketplaces.map((m, i) => [m, reconcilers[i]]));

    for (const marketplace of scopeMarketplaces) {
      const orders = inScope.filter(([, lines]) => lines[0].marketplace === marketplace);
      const orderIds = orders.map(([, lines]) => lines[0].orderId);
      const skus = lotCostOf
        ? []
        : orders.flatMap(([, lines]) => lines.map((l) => l.offerId).filter(Boolean));
      const [journal, unitCostOf] = await Promise.all([
        this.operations.liveByOrderIds(telegramUserId, orderIds, marketplace),
        this.cogs.unitCostResolver(telegramUserId, marketplace, skus),
      ]);
      const documents = await this.documentIds(
        telegramUserId,
        journal.map((op) => op.id),
      );
      const costOf: TOrderCostOf = (line, moment): TOrderUnitCost =>
        line.offerId
          ? unitCostOf(line.offerId, moment)
          : { status: 'unknown', reason: 'no-product' };

      for (const [key, lines] of orders) {
        const orderId = lines[0].orderId;
        const operations: IOrderCardOperation[] = [
          ...journal
            .filter((op) => op.orderId === orderId)
            .map((op) => journalOperationOf(op, marketplace, documents.get(op.id) ?? null)),
          ...manualOps.filter((op) => op.marketplace === marketplace && op.orderId === orderId),
        ];
        const result = orderResultOf({
          marketplace,
          orderId,
          lines,
          operations,
          costOf,
          lotCostOf,
          allocations: allocations.get(key),
        });
        const reconcile: TOrderReconcileState | null =
          marketplace === 'wb' ? 'unknown' : (reconcileOf.get(marketplace)?.(orderId) ?? null);
        const profit = orderProfitStateOf({
          result,
          lines,
          reconcile,
          forecastOf: marketplace === 'ym' ? (forecastOf ?? undefined) : undefined,
        });
        const snapshot = await this.results.recordSnapshot(
          telegramUserId,
          { marketplace, orderId },
          profit,
          now,
        );
        computed.push({
          key,
          marketplace,
          orderId,
          lines,
          operations,
          result,
          profit,
          costOf,
          lotCostOf,
          snapshot,
        });
      }
    }

    return {
      marketplaces,
      methodTitle: ALLOCATION_METHOD_TITLE[method],
      cogsMethod,
      orders: computed,
      unallocatedKopecks,
    };
  }

  /** Номер исходного документа строк журнала (`last_document_id`) — тем же `byIds`, что раскрытие P&L. */
  private async documentIds(
    telegramUserId: string,
    ids: readonly string[],
  ): Promise<Map<string, string | null>> {
    const unique = [...new Set(ids)];
    const result = new Map<string, string | null>();
    if (!unique.length) return result;
    for (const row of await this.operations.byIds(telegramUserId, unique)) {
      result.set(row.id, row.documentId);
    }
    return result;
  }

  /**
   * Прогноз ЯМ — ставки «Калькулятора цен» за 30 дней: один `build` на задачу,
   * товар без продаж в окне — средние аккаунта (как `forSku`).
   */
  private async ymForecast(
    telegramUserId: string,
    store: YandexMarketDocument | null,
    now: Date,
  ): Promise<TOrderForecastOf> {
    const rates = await this.priceCalc.build(telegramUserId, store, now);
    const bySku = new Map<string, ICalcSku>(rates.skus.map((sku) => [sku.sku, sku]));
    return (line) => {
      const sku = line.offerId ? bySku.get(line.offerId) : undefined;
      return orderForecastRatesOf(sku ?? { rates: rates.account });
    };
  }

  /**
   * Состояние сверки месяца площадки по заказу (`orderReconcileStateOf`): ЯМ — по актам,
   * Ozon — сверка v2 по сальдо месяца (TASK-227).
   */
  private async reconcileOf(
    telegramUserId: string,
    month: IFinancePeriod,
    now: Date,
    marketplace: TFinanceMarketplace,
  ): Promise<(orderId: string) => TOrderReconcileState> {
    const result = await this.reconcile.reconcile(telegramUserId, month, now, marketplace);
    return (orderId) => orderReconcileStateOf(result, orderId);
  }
}
