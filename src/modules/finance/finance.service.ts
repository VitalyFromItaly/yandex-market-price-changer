import type { IFinancePeriod } from './finance-period';
import type { TFinancePeriodStatus } from './finance-period-status';
import type { IPnl, IPnlLine, TPnlCostOf } from './pnl';
import type { IProfitActual } from './profit-actual';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { IProfitTotals } from '../yandex/reports/profit';
import type { IReportPeriod } from '../yandex/reports/report-period';

import { Injectable } from '@nestjs/common';

import { FinanceOperationRepository } from '../../database/postgres/repositories/finance-operation.repository';
import { FinancePeriodRepository } from '../../database/postgres/repositories/finance-period.repository';
import { CostHistoryService } from '../../database/services/cost-history.service';
import { PurchasePriceService } from '../../database/services/purchase-price.service';
import { YandexMarketService } from '../../database/services/yandex-market.service';
import { ErrorReporter } from '../errors/error-reporter.service';
import { datedCosts } from '../products/cost-history.domain';
import { DEFAULT_RATES, ratesOf } from '../yandex/reports/profit';
import { profitMainBlock } from '../yandex/reports/profit-message';
import { ProfitService } from '../yandex/reports/profit.service';
import { PERIOD } from '../yandex/reports/report-period';

import { FinanceExpensesService } from './finance-expenses.service';
import {
  assertFinancePeriod,
  financePeriodKey,
  FINANCE_REPORT_TYPE,
  financeToday,
  monthPeriod,
  monthsOf,
} from './finance-period';
import { combinedPeriodStatus, FINANCE_PERIOD_STATUS_LABEL } from './finance-period-status';
import { FinanceTaxService } from './finance-tax.service';
import { emptyAllocation, shareAllocation } from './marketplace-compare';
import { pnlLineOf, pnlOf } from './pnl';
import {
  ACTUAL_ALL_REASON,
  ACTUAL_UNAVAILABLE_REASON,
  financePeriodOf,
  preliminaryReason,
} from './profit-actual';

/** Статус месяца, который задевает период P&L. */
export interface IPnlMonthStatus {
  from: string;
  to: string;
  /** null — журнал месяца не загружен. */
  status: TFinancePeriodStatus | null;
}

/** Плоская оценка «Прибыли» рядом с непроверенным P&L — рубли, как в отчёте бота. */
export interface IPnlFlatEstimate {
  label: string;
  /** Какой набор заказов посчитан: оформленные или выкупленные. */
  block: 'placed' | 'redeemed';
  revenue: number;
  commission: number;
  tax: number;
  promo: number;
  purchase: number;
  net: number;
  orders: number;
}

export interface IPnlBuildOptions {
  /** false — без плоской оценки рядом. По умолчанию true: «Финансы» её показывают. */
  flat?: boolean;
  /**
   * Чей журнал (TASK-131). По умолчанию ЯМ — все экраны и бот видят прежние
   * числа; площадки рядом с общими правилами учёта — `compare` (TASK-137).
   */
  marketplace?: TFinanceMarketplace;
}

/** Ответ `compare`: P&L площадок в порядке запроса. */
export interface IPnlCompareReport {
  reports: { marketplace: TFinanceMarketplace; report: IPnlReport }[];
  /** Операционные расходы кабинета за период — то, что делилось. */
  operatingExpensesKopecks: number;
  /** false — выручки > 0 нет нигде, расходы не разделены и в чистую не вошли. */
  opexShared: boolean;
  taxIsDefault: boolean;
}

export interface IPnlReport {
  pnl: IPnl;
  status: TFinancePeriodStatus;
  statusLabel: string;
  months: IPnlMonthStatus[];
  /** Налоговые настройки — умолчание, продавец их не подтверждал. */
  taxIsDefault: boolean;
  flat: IPnlFlatEstimate | null;
  /** Почему плоской оценки нет; null — она есть или не нужна (период проверен). */
  flatNote: string | null;
}

export const FLAT_ONLY_CURRENT_MONTH =
  'Плоская оценка по ставкам есть только для текущего месяца — отчёты заказов не строят прошлые месяцы';
export const FLAT_NO_STORE = 'Магазин не подключён — плоскую оценку считать не по чему';
export const FLAT_FAILED = 'Плоская оценка не построилась: Маркет не ответил';
export const FLAT_YM_ONLY = 'Плоская оценка по ставкам есть только у Яндекс.Маркета';

/** Начало московского дня `ГГГГ-ММ-ДД` как момент. */
const moscowStart = (day: string) => new Date(`${day}T00:00:00+03:00`);
const DAY_MS = 86_400_000;

/**
 * Движок P&L (TASK-120): реальная прибыль периода из журнала операций площадки.
 * Единственная дверь к ней — экран «Финансы» (TASK-124) и скрипт сверки зовут
 * `build`. Входы — уже готовые двери, второй формулы здесь нет: налог —
 * `FinanceTaxService` + `taxOf`, расходы — `allocatedFor`, себестоимость —
 * `datedCosts`, плоская — `ProfitService`.
 */
@Injectable()
export class FinanceService {
  constructor(
    private readonly operations: FinanceOperationRepository,
    private readonly periods: FinancePeriodRepository,
    private readonly taxes: FinanceTaxService,
    private readonly expenses: FinanceExpensesService,
    private readonly stores: YandexMarketService,
    private readonly purchasePrices: PurchasePriceService,
    private readonly costHistory: CostHistoryService,
    private readonly profit: ProfitService,
    private readonly errors: ErrorReporter,
  ) {}

  async build(
    telegramUserId: string,
    period: IFinancePeriod,
    now: Date = new Date(),
    options: IPnlBuildOptions = {},
  ): Promise<IPnlReport> {
    assertFinancePeriod(period);
    const marketplace = options.marketplace ?? 'ym';

    const [taxSnapshot, allocation, store] = await Promise.all([
      this.taxes.snapshot(telegramUserId),
      this.expenses.allocatedFor(telegramUserId, period),
      this.stores.findByTelegramUser(telegramUserId),
    ]);
    const { lines, costOf, months } = await this.journal(
      telegramUserId,
      period,
      marketplace,
      store,
    );

    const pnl = pnlOf({ lines, period, costOf, expenses: allocation, tax: taxSnapshot.settings });
    const status = combinedPeriodStatus(months.map((month) => month.status));
    // «Обзору» плоская оценка не нужна: это Маркет и десятки секунд (TASK-125).
    // У Ozon её нет вовсе: «Прибыль» по ставкам считает только заказы ЯМ.
    let flat: IPnlFlatEstimate | null = null;
    let flatNote: string | null = null;
    if (status !== 'verified' && options.flat !== false) {
      ({ flat, flatNote } =
        marketplace === 'ym'
          ? await this.flat(telegramUserId, store, period, now)
          : { flat: null, flatNote: FLAT_YM_ONLY });
    }

    return {
      pnl,
      status,
      statusLabel: FINANCE_PERIOD_STATUS_LABEL[status],
      months,
      taxIsDefault: taxSnapshot.isDefault,
      flat,
      flatNote,
    };
  }

  /**
   * «Сравнение площадок» (TASK-137): P&L каждой площадки за один период с
   * одинаковыми правилами учёта. Отличие от трёх `build` — в двух местах, оба
   * решения владельца: налог по начислению у всех (`compare_tax_by_accrual`) и
   * операционные расходы кабинета по доле выручки (`compare_opex_by_revenue_share`).
   * Без плоской оценки. `pnlOf` чистый, поэтому первый проход без расходов —
   * только чтобы узнать выручку, — запросов к базе не добавляет.
   */
  async compare(
    telegramUserId: string,
    period: IFinancePeriod,
    marketplaces: readonly TFinanceMarketplace[],
  ): Promise<IPnlCompareReport> {
    assertFinancePeriod(period);
    const [taxSnapshot, allocation, store] = await Promise.all([
      this.taxes.snapshot(telegramUserId),
      this.expenses.allocatedFor(telegramUserId, period),
      this.stores.findByTelegramUser(telegramUserId),
    ]);
    const tax = { ...taxSnapshot.settings, recognition: 'realization' as const };
    const journals = await Promise.all(
      marketplaces.map((marketplace) => this.journal(telegramUserId, period, marketplace, store)),
    );
    const revenues = journals.map(
      ({ lines, costOf }) =>
        pnlOf({ lines, period, costOf, expenses: emptyAllocation(), tax }).revenueKopecks,
    );
    const shares = shareAllocation(allocation, revenues);

    const reports = marketplaces.map((marketplace, index) => {
      const { lines, costOf, months } = journals[index];
      const expenses = shares ? shares[index] : emptyAllocation();
      const pnl = pnlOf({ lines, period, costOf, expenses, tax });
      const status = combinedPeriodStatus(months.map((month) => month.status));
      return {
        marketplace,
        report: {
          pnl,
          status,
          statusLabel: FINANCE_PERIOD_STATUS_LABEL[status],
          months,
          taxIsDefault: taxSnapshot.isDefault,
          flat: null,
          flatNote: null,
        },
      };
    });
    return {
      reports,
      operatingExpensesKopecks: allocation.totalKopecks,
      opexShared: shares !== null,
      taxIsDefault: taxSnapshot.isDefault,
    };
  }

  /** Строки журнала площадки за период, закуп на дату и статусы месяцев. */
  private async journal(
    telegramUserId: string,
    period: IFinancePeriod,
    marketplace: TFinanceMarketplace,
    store: Awaited<ReturnType<YandexMarketService['findByTelegramUser']>>,
  ): Promise<{ lines: IPnlLine[]; costOf: TPnlCostOf; months: IPnlMonthStatus[] }> {
    const from = moscowStart(period.from);
    const to = new Date(moscowStart(period.to).getTime() + DAY_MS);
    const [operations, months] = await Promise.all([
      this.operations.liveForPnl(telegramUserId, from, to, marketplace),
      this.monthStatuses(telegramUserId, period, marketplace),
    ]);
    const lines = operations.map(pnlLineOf);
    const costOf = await this.costs(
      telegramUserId,
      lines.filter((line) => line.goods && line.sku).map((line) => line.sku as string),
      store ? ratesOf(store) : DEFAULT_RATES,
    );
    return { lines, costOf, months };
  }

  /**
   * «Фактическая чистая» для периода отчёта бота (TASK-126) — одна дверь для
   * кнопки, рассылки и kind-а CRM, поэтому три канала не расходятся.
   *
   * P&L строится только у ПРОВЕРЕННОГО периода: непроверенный всё равно
   * печатает плоскую с пометкой, и считать журнал ради неё незачем. Плоской
   * оценки здесь нет (`flat: false`): плоскую «Прибыль» вызывающий уже
   * посчитал, второй поход в Маркет не нужен. Сбой Postgres отчёт не роняет —
   * `unavailable`, в журнал без алерта (алерт даст самопроверка базы).
   */
  async actualNet(
    telegramUserId: string,
    period: IReportPeriod,
    now: Date = new Date(),
  ): Promise<IProfitActual> {
    const range = financePeriodOf(period, now);
    if (!range) return { state: 'preliminary', reason: ACTUAL_ALL_REASON };

    try {
      const months = await this.monthStatuses(telegramUserId, range);
      const status = combinedPeriodStatus(months.map((month) => month.status));
      if (status !== 'verified') {
        return {
          state: 'preliminary',
          reason: preliminaryReason(FINANCE_PERIOD_STATUS_LABEL[status]),
        };
      }

      const report = await this.build(telegramUserId, range, now, { flat: false });
      return {
        state: 'verified',
        netKopecks: report.pnl.netKopecks,
        unconfirmed: report.pnl.unconfirmed,
        from: range.from,
        to: range.to,
      };
    } catch (error) {
      void this.errors.report({
        error,
        source: 'queue',
        context: 'finance:profit-actual',
        telegramUserId,
        alert: false,
      });
      return { state: 'unavailable', reason: ACTUAL_UNAVAILABLE_REASON };
    }
  }

  /**
   * Закуп штуки артикула журнала на день, копейки, — та же дверь, что у P&L,
   * для прибыли заказа (TASK-144): скидка бренда — по ставкам активного магазина.
   */
  async costOfSkus(telegramUserId: string, skus: readonly string[]): Promise<TPnlCostOf> {
    const store = await this.stores.findByTelegramUser(telegramUserId);
    return this.costs(telegramUserId, skus, store ? ratesOf(store) : DEFAULT_RATES);
  }

  /**
   * Закуп штуки на день, копейки. Цена прайса за вычетом скидки бренда — тот же
   * `datedCosts`, что у «Прибыли»; день строки продажи подставляется вместо
   * `creationDate` заказа (решение `pnl_cogs_sale_day`).
   */
  private async costs(
    telegramUserId: string,
    skus: readonly string[],
    rates: ReturnType<typeof ratesOf>,
  ): Promise<TPnlCostOf> {
    const unique = [...new Set(skus)];
    const [rows, histories] = await Promise.all([
      this.purchasePrices.findBySkus(telegramUserId, unique),
      this.costHistory.findForSkus(telegramUserId, unique),
    ]);
    const costOf = datedCosts(rows, histories, rates);
    return (sku, day) => {
      const rub = costOf(sku, { creationDate: day });
      return rub === undefined ? undefined : Math.round(rub * 100);
    };
  }

  /**
   * Статус журнала по месяцам периода; `null` — месяц не загружен. Публичный
   * для ИИ (TASK-165): ДДС и налоговый год такого сигнала не несут, а «не
   * загружен» нельзя выдать моделью за нули.
   */
  async monthStatuses(
    telegramUserId: string,
    period: IFinancePeriod,
    marketplace: TFinanceMarketplace = 'ym',
  ): Promise<IPnlMonthStatus[]> {
    return Promise.all(
      monthsOf(period).map(async (month) => {
        const row = await this.periods.find({
          marketplace,
          telegramUserId,
          periodKey: financePeriodKey(FINANCE_REPORT_TYPE[marketplace], month),
        });
        return { from: month.from, to: month.to, status: row?.status ?? null };
      }),
    );
  }

  /**
   * Плоская формула рядом с непроверенным периодом (решение
   * `finance_actual_beside_flat`) — только текущий месяц
   * (`pnl_flat_current_month_only`): отчёты заказов знают периоды бота, а не
   * произвольный месяц. Сбой Маркета P&L не роняет.
   */
  private async flat(
    telegramUserId: string,
    store: Awaited<ReturnType<YandexMarketService['findByTelegramUser']>>,
    period: IFinancePeriod,
    now: Date,
  ): Promise<{ flat: IPnlFlatEstimate | null; flatNote: string | null }> {
    const today = financeToday(now);
    const current = monthPeriod(Number(today.slice(0, 4)), Number(today.slice(5, 7)));
    if (period.from !== current.from || period.to !== current.to) {
      return { flat: null, flatNote: FLAT_ONLY_CURRENT_MONTH };
    }
    if (!store) return { flat: null, flatNote: FLAT_NO_STORE };

    try {
      const report = await this.profit.build(store, { key: PERIOD.MONTH }, now);
      const block = profitMainBlock(report);
      return {
        flat: flatOf(block, block === 'placed' ? report.placed : report.totals),
        flatNote: null,
      };
    } catch (error) {
      void this.errors.report({
        error,
        source: 'yandex',
        context: 'finance:pnl-flat',
        telegramUserId,
        alert: false,
      });
      return { flat: null, flatNote: FLAT_FAILED };
    }
  }
}

function flatOf(block: 'placed' | 'redeemed', totals: IProfitTotals): IPnlFlatEstimate {
  return {
    label: FINANCE_PERIOD_STATUS_LABEL.preliminary,
    block,
    revenue: totals.revenue,
    commission: totals.commission,
    tax: totals.tax,
    promo: totals.promo,
    purchase: totals.purchase,
    net: totals.net,
    orders: totals.orders,
  };
}
