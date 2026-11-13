import type {
  IDashboardCatalog,
  IDashboardFilter,
  IDashboardItem,
  IDashboardMoney,
  IDashboardTotals,
  TDashboardBasis,
  TDashboardLine,
  TDashboardSource,
} from './accounting-dashboard.domain';
import type { IOrderCardOperation, IOrderCardOperationView } from './accounting-order-card.domain';
import type { IAccountingOrderLineInput } from './accounting-order-lines.domain';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { TAccountingOrderLineRow } from '../../database/postgres/repositories/accounting-order-line.repository';
import type { TFinanceExpenseRow } from '../../database/postgres/repositories/finance-expense.repository';
import type { YandexMarketDocument } from '../../database/schemas/yandex-market.schema';
import type { ICashflowReport } from '../finance/finance-cashflow.service';
import type { IFinancePeriod } from '../finance/finance-period';

import { Injectable } from '@nestjs/common';

import { AccountingOrderLineRepository } from '../../database/postgres/repositories/accounting-order-line.repository';
import { FinanceOperationRepository } from '../../database/postgres/repositories/finance-operation.repository';
import { MARKETPLACE_LABEL } from '../../shared/marketplace';
import { expenseCashDays } from '../finance/cashflow';
import { expenseShare } from '../finance/expense-allocation';
import { labelResolver } from '../finance/expense.domain';
import { FinanceCashflowService } from '../finance/finance-cashflow.service';
import { FinanceExpensesService } from '../finance/finance-expenses.service';
import { monthPeriod } from '../finance/finance-period';

import {
  ALL_MARKETPLACES_LABEL,
  DASHBOARD_BASIS_HINT,
  DASHBOARD_BASIS_TITLE,
  catalogOf,
  dashboardLineOfArticle,
  dashboardLineTitle,
  dashboardTotalsOf,
  drillItemsOf,
  filterDashboardItems,
  hasItemFilter,
  operationItemOf,
  orderCreatedOn,
  saleItemsOf,
} from './accounting-dashboard.domain';
import { AccountingManualOperationsService } from './accounting-manual-operations.service';
import {
  groupLinesByOrder,
  journalOperationOf,
  manualOperationOf,
  operationViewsOf,
} from './accounting-order-card.domain';
import { AccountingOrderCardService } from './accounting-order-card.service';
import { lineValueOf } from './accounting-order-lines.domain';
import { AccountingTaxService } from './accounting-tax.service';
import { AccountingService } from './accounting.service';

const DAY_MS = 86_400_000;
const moscowStart = (day: string) => new Date(`${day}T00:00:00+03:00`);
const CHUNK = 1000;

/** Потолок строк раскрытия: больше на экране не читают, `total` говорит, сколько всего. */
export const DASHBOARD_DRILL_LIMIT = 500;

type TFeatures = Readonly<Record<string, boolean>>;

export interface IDashboardQuery {
  basis: TDashboardBasis;
  period: IFinancePeriod;
  filter: IDashboardFilter;
}

export interface IAccountingDashboard {
  basis: TDashboardBasis;
  basisTitle: string;
  basisHint: string;
  period: IFinancePeriod;
  filter: IDashboardFilter;
  marketplaces: TFinanceMarketplace[];
  totals: IDashboardTotals;
  /** «К выплате» — на этот день, а не на конец периода. */
  payableAsOf: string | null;
  /** Почему часть строк не вошла при фильтре; null — фильтр ничего не отбросил. */
  filterNote: string | null;
  /** Дата последнего успешного обновления журнала: общая (самая ранняя) и по площадкам. */
  sync: {
    asOf: string | null;
    marketplaces: {
      marketplace: TFinanceMarketplace;
      label: string;
      lastSuccessAt: string | null;
    }[];
  };
}

export interface IDashboardDrillOrder {
  marketplace: TFinanceMarketplace;
  orderId: string;
  title: string;
  kopecks: number | null;
  expected: boolean;
  reason: string | null;
}

export interface IDashboardDrillRecord {
  source: TDashboardSource;
  id: string;
  title: string;
  kopecks: number | null;
}

export interface IAccountingDashboardDrill {
  basis: TDashboardBasis;
  period: IFinancePeriod;
  line: TDashboardLine;
  title: string;
  marketplace: TFinanceMarketplace | null;
  label: string;
  /** Σ строки — то же число, что в итогах панели. */
  kopecks: number | null;
  operations: IOrderCardOperationView[];
  operationsTotal: number;
  /** Суммы карточек без своих операций (себестоимость, распределённое, ожидаемое) — ссылкой на карточку. */
  orders: IDashboardDrillOrder[];
  ordersTotal: number;
  /** Расходы, оплаты закупа, налог — записи продавца. */
  records: IDashboardDrillRecord[];
}

interface IComputed {
  marketplaces: TFinanceMarketplace[];
  items: IDashboardItem[];
  /** Операции, на которые ссылаются кирпичи, — для раскрытия. */
  operations: IOrderCardOperation[];
  catalog: IDashboardCatalog;
  money: Map<TFinanceMarketplace, IDashboardMoney>;
  payableAsOf: string | null;
}

function lineInputOf(row: TAccountingOrderLineRow): IAccountingOrderLineInput {
  return {
    ...lineValueOf(row),
    marketplace: row.marketplace,
    orderId: row.orderId,
    itemId: row.itemId,
  };
}

/** Заказ ЯМ — магазина из URL (кампания в строках); Ozon/WB — без магазина. Как у карточки. */
function inStore(
  lines: readonly IAccountingOrderLineInput[] | undefined,
  store: YandexMarketDocument | null,
): boolean {
  if (!lines?.length || lines[0].marketplace !== 'ym') return true;
  return lines.some((l) => l.campaignId === String(store?.campaign_id));
}

function chunks<T>(list: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) result.push(list.slice(i, i + CHUNK));
  return result;
}

/**
 * Панель «Финучёта» (ТЗ п.13, TASK-229): итоги периода в выбранном базисе и
 * раскрытие каждой строки до операций. Своих формул нет: базис «продажа» —
 * суммы карточек заказов (`AccountingOrderCardService.periodOrders`), «начисление» —
 * журнал и ручные операции по дню начисления + налог периода
 * (`AccountingTaxService.period`) + доля расходов (`expenseShare`) + себестоимость
 * карточек заказов, чья продажа начислена в периоде, «деньги» — ДДС
 * (`FinanceCashflowService.build`, `expenseCashDays`). Решение `accounting_dashboard_bases`.
 */
@Injectable()
export class AccountingDashboardService {
  constructor(
    private readonly accounting: AccountingService,
    private readonly orderCards: AccountingOrderCardService,
    private readonly operations: FinanceOperationRepository,
    private readonly orderLines: AccountingOrderLineRepository,
    private readonly manual: AccountingManualOperationsService,
    private readonly tax: AccountingTaxService,
    private readonly expenses: FinanceExpensesService,
    private readonly cashflow: FinanceCashflowService,
  ) {}

  async summary(
    telegramUserId: string,
    features: TFeatures,
    store: YandexMarketDocument | null,
    query: IDashboardQuery,
    now: Date = new Date(),
  ): Promise<IAccountingDashboard> {
    const [computed, sync] = await Promise.all([
      this.compute(telegramUserId, features, store, query, now),
      this.accounting.syncStatus(telegramUserId, features, now),
    ]);
    const filtered = filterDashboardItems(computed.items, query.filter, computed.catalog);
    const itemFilter = hasItemFilter(query.filter);
    const totals = dashboardTotalsOf(
      query.basis,
      filtered.items,
      computed.marketplaces,
      (marketplace) =>
        itemFilter
          ? { payableKopecks: null, receivedKopecks: null }
          : (computed.money.get(marketplace) ?? { payableKopecks: null, receivedKopecks: null }),
    );
    const shown = new Set(computed.marketplaces);
    return {
      basis: query.basis,
      basisTitle: DASHBOARD_BASIS_TITLE[query.basis],
      basisHint: DASHBOARD_BASIS_HINT[query.basis],
      period: query.period,
      filter: query.filter,
      marketplaces: computed.marketplaces,
      totals,
      payableAsOf: computed.payableAsOf,
      filterNote: filterNoteOf(query.filter, filtered.droppedCount),
      sync: {
        asOf: sync.asOf,
        marketplaces: sync.marketplaces
          .filter((m) => shown.has(m.marketplace))
          .map((m) => ({
            marketplace: m.marketplace,
            label: m.label,
            lastSuccessAt: m.lastSuccessAt,
          })),
      },
    };
  }

  /** Строка итога до операций: тем же расчётом, что `summary`, — Σ раскрытия = числу панели. */
  async drill(
    telegramUserId: string,
    features: TFeatures,
    store: YandexMarketDocument | null,
    query: IDashboardQuery,
    target: { line: TDashboardLine; marketplace: TFinanceMarketplace | null },
    now: Date = new Date(),
  ): Promise<IAccountingDashboardDrill> {
    const computed = await this.compute(telegramUserId, features, store, query, now);
    const { items } = filterDashboardItems(computed.items, query.filter, computed.catalog);
    const own = drillItemsOf(items, target.line, target.marketplace);

    const ids = [...new Set(own.flatMap((item) => item.operationIds))];
    const views = operationViewsOf(
      ids,
      computed.operations,
      (op) => dashboardLineOfArticle(op.article),
      target.line,
    );
    const shownViews = views.slice(0, DASHBOARD_DRILL_LIMIT);
    await this.fillDocuments(telegramUserId, shownViews);

    const orders = own
      .filter((item) => item.source === 'order' && !item.operationIds.length && item.orderKey)
      .map((item) => {
        const split = item.orderKey.indexOf('|');
        return {
          marketplace: item.orderKey.slice(0, split) as TFinanceMarketplace,
          orderId: item.orderKey.slice(split + 1),
          title: item.title,
          kopecks: item.kopecks,
          expected: item.expected,
          reason: item.reason,
        };
      });
    const records = own
      .filter((item) => item.refId)
      .map((item) => ({
        source: item.source,
        id: item.refId,
        title: item.title,
        kopecks: item.kopecks,
      }));

    let kopecks: number | null = 0;
    for (const item of own) {
      if (item.kopecks === null) kopecks = null;
      else if (kopecks !== null) kopecks += item.kopecks;
    }
    return {
      basis: query.basis,
      period: query.period,
      line: target.line,
      title: dashboardLineTitle(query.basis, target.line),
      marketplace: target.marketplace,
      label: target.marketplace ? MARKETPLACE_LABEL[target.marketplace] : ALL_MARKETPLACES_LABEL,
      kopecks: kopecks === null ? null : kopecks + 0,
      operations: shownViews,
      operationsTotal: views.length,
      orders: orders.slice(0, DASHBOARD_DRILL_LIMIT),
      ordersTotal: orders.length,
      records: records.slice(0, DASHBOARD_DRILL_LIMIT),
    };
  }

  private async compute(
    telegramUserId: string,
    features: TFeatures,
    store: YandexMarketDocument | null,
    query: IDashboardQuery,
    now: Date,
  ): Promise<IComputed> {
    const enabled = await this.accounting.marketplacesOf(telegramUserId, features);
    // Панель — магазина из URL: без магазина ЯМ его заказы и журнал не показываются (как список заказов).
    const marketplaces = enabled.filter(
      (m) =>
        (!query.filter.marketplace || m === query.filter.marketplace) &&
        (m !== 'ym' || Boolean(store?.campaign_id)),
    );
    const reports = new Map<TFinanceMarketplace, ICashflowReport>();
    for (const marketplace of marketplaces) {
      reports.set(
        marketplace,
        await this.cashflow.build(telegramUserId, query.period, now, marketplace),
      );
    }
    const money = new Map<TFinanceMarketplace, IDashboardMoney>(
      [...reports].map(([marketplace, report]) => [
        marketplace,
        {
          payableKopecks: report.receivable.totalKopecks,
          receivedKopecks: report.cashflow.inflow.payoutsKopecks,
        },
      ]),
    );
    const payableAsOf = [...reports.values()][0]?.receivable.asOf ?? null;

    let part: Pick<IComputed, 'items' | 'operations' | 'catalog'>;
    if (query.basis === 'sale') {
      part = await this.saleBasis(telegramUserId, features, store, query, marketplaces, now);
    } else if (query.basis === 'accrual') {
      part = await this.accrualBasis(telegramUserId, features, store, query, marketplaces, now);
    } else {
      part = await this.cashBasis(telegramUserId, store, query, marketplaces, reports);
    }
    return { marketplaces, money, payableAsOf, ...part };
  }

  /** Базис «продажа»: заказы, оформленные в периоде, — суммы их карточек. */
  private async saleBasis(
    telegramUserId: string,
    features: TFeatures,
    store: YandexMarketDocument | null,
    query: IDashboardQuery,
    marketplaces: readonly TFinanceMarketplace[],
    now: Date,
  ): Promise<Pick<IComputed, 'items' | 'operations' | 'catalog'>> {
    const created = await this.orderCards.ordersCreatedIn(
      telegramUserId,
      features,
      store,
      query.period,
      query.filter.marketplace ?? null,
      now,
    );
    const orders = created.filter((o) => marketplaces.includes(o.marketplace));
    return {
      items: orders.flatMap((order) => saleItemsOf(order)),
      operations: orders.flatMap((order) => order.operations),
      catalog: catalogOf(orders.flatMap((order) => order.lines)),
    };
  }

  /** Базис «начисление»: всё, что признано в дни периода. */
  private async accrualBasis(
    telegramUserId: string,
    features: TFeatures,
    store: YandexMarketDocument | null,
    query: IDashboardQuery,
    marketplaces: readonly TFinanceMarketplace[],
    now: Date,
  ): Promise<Pick<IComputed, 'items' | 'operations' | 'catalog'>> {
    const from = moscowStart(query.period.from);
    const to = new Date(moscowStart(query.period.to).getTime() + DAY_MS);
    const enabled = new Set(marketplaces);

    const operations: IOrderCardOperation[] = [];
    for (const marketplace of marketplaces) {
      const journal = await this.operations.liveForPnl(telegramUserId, from, to, marketplace);
      // `liveForPnl` подмешивает налоговые строки по дню выплаты — здесь только по дню начисления.
      operations.push(
        ...journal
          .filter((op) => op.accruedAt >= from && op.accruedAt < to)
          .map((op) => journalOperationOf(op, marketplace, null)),
      );
    }
    const manualRows = await this.manual.liveFor(telegramUserId, query.period);
    operations.push(
      ...manualRows
        .filter((row) => enabled.has(row.marketplace))
        .map((row) => manualOperationOf(row)),
    );

    const linesByOrder = await this.linesOfOrders(telegramUserId, operations);
    const visible = operations.filter((op) =>
      inStore(op.orderId ? linesByOrder.get(`${op.marketplace}|${op.orderId}`) : undefined, store),
    );
    const items = visible
      .map(operationItemOf)
      .filter((item): item is IDashboardItem => Boolean(item));

    // Себестоимость — заказов, чья продажа начислена в периоде: карточкой их месяца оформления.
    const soldKeys = new Set(
      visible
        .filter((op) => op.article === 'sales' && op.orderId)
        .map((op) => `${op.marketplace}|${op.orderId}`),
    );
    const keysByMonth = new Map<string, string[]>();
    for (const key of soldKeys) {
      const day = orderCreatedOn(linesByOrder.get(key) ?? []);
      if (!day) continue;
      const month = day.slice(0, 7);
      keysByMonth.set(month, [...(keysByMonth.get(month) ?? []), key]);
    }
    const cogsLines = new Set<TDashboardLine>(['cogs']);
    for (const [month, keys] of keysByMonth) {
      const [year, mm] = month.split('-').map(Number);
      const orders = await this.orderCards.periodOrders(
        telegramUserId,
        features,
        store,
        monthPeriod(year, mm),
        { onlyKeys: keys },
        now,
      );
      for (const order of orders) items.push(...saleItemsOf(order, cogsLines));
    }

    const [expenseItems, tax] = await Promise.all([
      this.expenseItems(telegramUserId, enabled, (row) => expenseShare(row, query.period)),
      this.tax.period(telegramUserId, features, query.period),
    ]);
    items.push(...expenseItems);
    if (tax.tax.taxKopecks) {
      items.push({
        marketplace: null,
        line: 'tax',
        kopecks: -tax.tax.taxKopecks,
        expected: false,
        source: 'tax',
        operationIds: [],
        refId: `tax:${query.period.from}:${query.period.to}`,
        orderKey: null,
        sku: null,
        title: `Налог периода — ${tax.ruleTitle}`,
        reason: null,
      });
    }
    return {
      items,
      operations: visible,
      catalog: catalogOf([...linesByOrder.values()].flat()),
    };
  }

  /** Базис «деньги»: выплаты площадок по статьям, оплаты закупа, налог и расходы — по дню оплаты. */
  private async cashBasis(
    telegramUserId: string,
    store: YandexMarketDocument | null,
    query: IDashboardQuery,
    marketplaces: readonly TFinanceMarketplace[],
    reports: ReadonlyMap<TFinanceMarketplace, ICashflowReport>,
  ): Promise<Pick<IComputed, 'items' | 'operations' | 'catalog'>> {
    const operations: IOrderCardOperation[] = [];
    for (const marketplace of marketplaces) {
      const ids = (reports.get(marketplace)?.cashflow.payoutArticles ?? []).flatMap(
        (row) => row.operationIds,
      );
      for (const part of chunks([...new Set(ids)])) {
        for (const row of await this.operations.byIds(telegramUserId, part)) {
          operations.push({
            ...row,
            subArticle: null,
            origin: 'journal',
            marketplace,
            documentId: row.documentId,
          });
        }
      }
    }
    const linesByOrder = await this.linesOfOrders(telegramUserId, operations);
    const visible = operations.filter((op) =>
      inStore(op.orderId ? linesByOrder.get(`${op.marketplace}|${op.orderId}`) : undefined, store),
    );
    const items = visible
      .map(operationItemOf)
      .filter((item): item is IDashboardItem => Boolean(item));

    // Закупки и уплаченный налог — кабинета целиком (как в ДДС): у любой площадки они одни.
    const first = [...reports.values()][0];
    for (const row of first?.cashflow.purchases ?? []) {
      items.push(recordItem('cogs', 'purchase', row.id, -row.amountKopecks, row.supplier));
    }
    for (const row of first?.cashflow.taxPayments ?? []) {
      items.push(
        recordItem('tax', 'tax', row.id, -row.amountKopecks, `Платёж налога ${row.paidDay}`),
      );
    }
    items.push(
      ...(await this.expenseItems(
        telegramUserId,
        new Set(marketplaces),
        (row) => expenseCashDays(row, query.period).length * row.amountKopecks,
      )),
    );
    return { items, operations: visible, catalog: catalogOf([...linesByOrder.values()].flat()) };
  }

  /**
   * Расходы продавца → кирпичи «Опер. расходов». Площадки и заказа — своей
   * площадки (выключенной — не показываются), бизнеса и товара — уровня кабинета.
   */
  private async expenseItems(
    telegramUserId: string,
    enabled: ReadonlySet<TFinanceMarketplace>,
    kopecksOf: (row: TFinanceExpenseRow) => number,
  ): Promise<IDashboardItem[]> {
    const snapshot = await this.expenses.snapshot(telegramUserId);
    const labelOf = labelResolver(snapshot.categories);
    const items: IDashboardItem[] = [];
    for (const row of snapshot.expenses) {
      const kopecks = kopecksOf(row);
      if (!kopecks) continue;
      const own = (row.scope === 'marketplace' || row.scope === 'order') && row.marketplace;
      if (own && !enabled.has(row.marketplace)) continue;
      items.push({
        ...recordItem('opex', 'expense', row.id, -kopecks, labelOf(row.category)),
        marketplace: own ? row.marketplace : null,
        orderKey:
          row.scope === 'order' && own && row.orderId ? `${row.marketplace}|${row.orderId}` : null,
        sku: row.scope === 'product' ? row.sku : null,
      });
    }
    return items;
  }

  /** Строки заказов, на которые ссылаются операции: магазин ЯМ, месяц оформления, товары. */
  private async linesOfOrders(
    telegramUserId: string,
    operations: readonly IOrderCardOperation[],
  ): Promise<Map<string, IAccountingOrderLineInput[]>> {
    const byMarketplace = new Map<TFinanceMarketplace, Set<string>>();
    for (const op of operations) {
      if (!op.orderId) continue;
      const set = byMarketplace.get(op.marketplace) ?? new Set<string>();
      set.add(op.orderId);
      byMarketplace.set(op.marketplace, set);
    }
    const lines: IAccountingOrderLineInput[] = [];
    for (const [marketplace, ids] of byMarketplace) {
      const rows = await this.orderLines.linesOfOrders(telegramUserId, [...ids], marketplace);
      lines.push(...rows.map(lineInputOf));
    }
    return groupLinesByOrder(lines);
  }

  /** Номер исходного документа у строк раскрытия — тем же `byIds`, что карточка. */
  private async fillDocuments(
    telegramUserId: string,
    views: IOrderCardOperationView[],
  ): Promise<void> {
    const missing = [
      ...new Set(views.filter((v) => v.origin === 'journal' && !v.documentId).map((v) => v.id)),
    ];
    const documentOf = new Map<string, string | null>();
    for (const part of chunks(missing)) {
      for (const row of await this.operations.byIds(telegramUserId, part)) {
        documentOf.set(row.id, row.documentId);
      }
    }
    for (const view of views) {
      if (documentOf.has(view.id)) view.documentId = documentOf.get(view.id) ?? null;
    }
  }
}

function recordItem(
  line: TDashboardLine,
  source: TDashboardSource,
  id: string,
  kopecks: number,
  title: string,
): IDashboardItem {
  return {
    marketplace: null,
    line,
    kopecks,
    expected: false,
    source,
    operationIds: [],
    refId: id,
    orderKey: null,
    sku: null,
    title,
    reason: null,
  };
}

function filterNoteOf(filter: IDashboardFilter, dropped: number): string | null {
  if (!dropped) return null;
  if (hasItemFilter(filter)) {
    return (
      'Показаны только строки выбранного заказа или товара. Общие расходы, налог, закуп, ' +
      'услуги без заказа и «к выплате» по товару не делятся — в итог не вошли.'
    );
  }
  if (filter.marketplace) {
    return 'Налог, закуп и расходы всего бизнеса относятся к кабинету целиком — в итог площадки не вошли.';
  }
  return null;
}
