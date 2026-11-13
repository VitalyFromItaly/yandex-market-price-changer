import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import { AccountingAnalyticsService } from '../../accounting/accounting-analytics.service';
import { AccountingDashboardService } from '../../accounting/accounting-dashboard.service';
import {
  AccountingOrderCardService,
  AccountingOrderNotFoundError,
} from '../../accounting/accounting-order-card.service';
import { parseReconcileMonth } from '../../accounting/accounting-reconcile.service';
import { AccountingReturnsService } from '../../accounting/accounting-returns.service';
import { AccountingTaxService } from '../../accounting/accounting-tax.service';
import { isTaxYearInRange } from '../../finance/tax-year.domain';
import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { moscowDay } from '../../yandex/reports/moscow-day';
import { CrmJobError } from '../jobs/crm-jobs.domain';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';
import { TAX_YEAR_INVALID_TEXT } from '../taxes/crm-taxes.domain';

import {
  ACCOUNTING_ANALYTICS_KIND,
  ACCOUNTING_DASHBOARD_BAD_BASIS_TEXT,
  ACCOUNTING_DASHBOARD_BAD_FILTER_TEXT,
  ACCOUNTING_DASHBOARD_BAD_LINE_TEXT,
  ACCOUNTING_DASHBOARD_BAD_PERIOD_TEXT,
  ACCOUNTING_DASHBOARD_DRILL_KIND,
  ACCOUNTING_DASHBOARD_KIND,
  ACCOUNTING_ORDERS_BAD_FILTER_TEXT,
  ACCOUNTING_ORDERS_BAD_MONTH_TEXT,
  ACCOUNTING_ORDERS_KIND,
  ACCOUNTING_ORDER_BAD_PARAMS_TEXT,
  ACCOUNTING_ORDER_KIND,
  ACCOUNTING_ORDER_NOT_FOUND_TEXT,
  ACCOUNTING_ORDER_NO_STORE_TEXT,
  ACCOUNTING_RETURNS_BAD_MONTH_TEXT,
  ACCOUNTING_RETURNS_KIND,
  ACCOUNTING_TAX_YEAR_KIND,
  parseAccountingDashboardLine,
  parseAccountingDashboardQuery,
  parseAccountingOrderParams,
  parseAccountingOrdersFilter,
  parseAccountingPeriodParams,
  toCrmAccountingAnalytics,
  toCrmAccountingDashboard,
  toCrmAccountingDashboardDrill,
  toCrmAccountingOrderCard,
  toCrmAccountingOrders,
  toCrmAccountingReturns,
  toCrmAccountingTaxYear,
} from './crm-accounting.domain';

/** Фичи карточки и списка заказов: зонтик + подфича (TASK-206). */
export const ACCOUNTING_ORDER_FEATURES = [FEATURE.FIN_ACCOUNTING, FEATURE.FIN_ACCOUNTING_ORDERS];
/** Фичи панели: зонтик + подфича (TASK-206, TASK-229). */
export const ACCOUNTING_DASHBOARD_FEATURES = [
  FEATURE.FIN_ACCOUNTING,
  FEATURE.FIN_ACCOUNTING_DASHBOARD,
];
/** Фичи возвратов: зонтик + подфича (TASK-206, TASK-225). */
export const ACCOUNTING_RETURNS_FEATURES = [FEATURE.FIN_ACCOUNTING, FEATURE.FIN_ACCOUNTING_RETURNS];

const DASHBOARD_QUERY_ERROR = {
  basis: ACCOUNTING_DASHBOARD_BAD_BASIS_TEXT,
  period: ACCOUNTING_DASHBOARD_BAD_PERIOD_TEXT,
  filter: ACCOUNTING_DASHBOARD_BAD_FILTER_TEXT,
} as const;

/**
 * Kind-ы «Финучёта». Налог года (TASK-221) — уровня аккаунта: журнал всех
 * площадок с 1 января, ручные операции и себестоимость v2 — секунды, поэтому
 * фоновая задача, а не GET (как `taxes:year`). Карточка и список заказов
 * (TASK-222) — магазина из URL (`scope: 'store'`, документ уже перекрыт
 * `scopeStore`): месяц журнала, распределение и налог периода — тоже секунды.
 * Панель и её раскрытие (TASK-229) — тоже магазина из URL: базис «продажа»
 * собирает карточки каждого месяца периода. Возвраты (TASK-225) — магазина из URL,
 * месяц оформления: те же карточки, что список заказов. Аналитика (TASK-230) —
 * часть главной, под фичами панели: заказы, оформленные в периоде.
 */
@Injectable()
export class CrmAccountingKinds implements OnModuleInit {
  constructor(
    private readonly registry: CrmJobsRegistry,
    private readonly tax: AccountingTaxService,
    private readonly orderCards: AccountingOrderCardService,
    private readonly dashboard: AccountingDashboardService,
    private readonly returnsService: AccountingReturnsService,
    private readonly analytics: AccountingAnalyticsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(ACCOUNTING_TAX_YEAR_KIND, {
      features: [FEATURE.FIN_ACCOUNTING],
      scope: 'account',
      run: (context) => this.taxYear(context),
    });
    this.registry.register(ACCOUNTING_ORDER_KIND, {
      features: ACCOUNTING_ORDER_FEATURES,
      run: (context) => this.order(context),
    });
    this.registry.register(ACCOUNTING_ORDERS_KIND, {
      features: ACCOUNTING_ORDER_FEATURES,
      run: (context) => this.orders(context),
    });
    this.registry.register(ACCOUNTING_DASHBOARD_KIND, {
      features: ACCOUNTING_DASHBOARD_FEATURES,
      run: (context) => this.dashboardSummary(context),
    });
    this.registry.register(ACCOUNTING_DASHBOARD_DRILL_KIND, {
      features: ACCOUNTING_DASHBOARD_FEATURES,
      run: (context) => this.dashboardDrill(context),
    });
    this.registry.register(ACCOUNTING_RETURNS_KIND, {
      features: ACCOUNTING_RETURNS_FEATURES,
      run: (context) => this.returns(context),
    });
    this.registry.register(ACCOUNTING_ANALYTICS_KIND, {
      features: ACCOUNTING_DASHBOARD_FEATURES,
      run: (context) => this.analyticsPeriod(context),
    });
  }

  async analyticsPeriod(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    const parsed = parseAccountingPeriodParams(context.params ?? {}, now);
    if (!parsed) throw new CrmJobError(ACCOUNTING_DASHBOARD_BAD_PERIOD_TEXT);
    const report = await this.analytics.period(
      context.telegramUserId,
      context.features ?? {},
      context.store,
      parsed.period,
      now,
    );
    return { data: toCrmAccountingAnalytics(report, parsed.periodEcho) };
  }

  async returns(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    const month = parseReconcileMonth(context.params?.month);
    if (!month) throw new CrmJobError(ACCOUNTING_RETURNS_BAD_MONTH_TEXT);
    const report = await this.returnsService.month(
      context.telegramUserId,
      context.features ?? {},
      context.store,
      month,
      now,
    );
    return { data: toCrmAccountingReturns(report) };
  }

  async taxYear(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    const year = Number(context.params?.year);
    if (!isTaxYearInRange(year, moscowDay(now).year)) throw new CrmJobError(TAX_YEAR_INVALID_TEXT);
    const report = await this.tax.year(context.telegramUserId, context.features ?? {}, year, now);
    return { data: toCrmAccountingTaxYear(report) };
  }

  async order(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    const target = parseAccountingOrderParams(context.params ?? {});
    if (!target) throw new CrmJobError(ACCOUNTING_ORDER_BAD_PARAMS_TEXT);
    if (target.marketplace === 'ym' && !context.store) {
      throw new CrmJobError(ACCOUNTING_ORDER_NO_STORE_TEXT);
    }
    try {
      const card = await this.orderCards.order(
        context.telegramUserId,
        context.features ?? {},
        context.store,
        target,
        now,
      );
      return { data: toCrmAccountingOrderCard(card) };
    } catch (error) {
      if (error instanceof AccountingOrderNotFoundError) {
        throw new CrmJobError(ACCOUNTING_ORDER_NOT_FOUND_TEXT);
      }
      throw error;
    }
  }

  async orders(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    const month = parseReconcileMonth(context.params?.month);
    if (!month) throw new CrmJobError(ACCOUNTING_ORDERS_BAD_MONTH_TEXT);
    const filter = parseAccountingOrdersFilter(context.params ?? {});
    if (!filter) throw new CrmJobError(ACCOUNTING_ORDERS_BAD_FILTER_TEXT);
    const list = await this.orderCards.orders(
      context.telegramUserId,
      context.features ?? {},
      context.store,
      month,
      filter,
      now,
    );
    return { data: toCrmAccountingOrders(list, filter) };
  }

  async dashboardSummary(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    const query = parseAccountingDashboardQuery(context.params ?? {}, now);
    if (typeof query === 'string') throw new CrmJobError(DASHBOARD_QUERY_ERROR[query]);
    const result = await this.dashboard.summary(
      context.telegramUserId,
      context.features ?? {},
      context.store,
      query,
      now,
    );
    return { data: toCrmAccountingDashboard(result, query) };
  }

  async dashboardDrill(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    const query = parseAccountingDashboardQuery(context.params ?? {}, now);
    if (typeof query === 'string') throw new CrmJobError(DASHBOARD_QUERY_ERROR[query]);
    const target = parseAccountingDashboardLine(context.params ?? {});
    if (!target) throw new CrmJobError(ACCOUNTING_DASHBOARD_BAD_LINE_TEXT);
    const result = await this.dashboard.drill(
      context.telegramUserId,
      context.features ?? {},
      context.store,
      query,
      target,
      now,
    );
    return { data: toCrmAccountingDashboardDrill(result, query) };
  }
}
