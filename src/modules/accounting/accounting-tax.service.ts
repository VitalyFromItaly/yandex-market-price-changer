import type {
  IAccountingTax,
  IAccountingTaxYear,
  IAccountingTaxYearPeriod,
  ITaxJournalOperation,
  ITaxManualOperation,
} from './accounting-tax';
import type { ITaxBaseRuleSnapshot } from './accounting-tax-settings.service';
import type { TOrderLotCostOf } from './order-result';
import type { IStoreCostItem } from './store-cost-allocation';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { IFinancePeriod } from '../finance/finance-period';
import type { ITaxReduction, ITaxYearParamsRow } from '../finance/finance-tax-year-data.service';
import type { IPnlOperation } from '../finance/pnl';
import type { ITaxSettings } from '../finance/tax.domain';

import { Injectable } from '@nestjs/common';

import { FinanceOperationRepository } from '../../database/postgres/repositories/finance-operation.repository';
import { FinancePurchaseRepository } from '../../database/postgres/repositories/finance-purchase.repository';
import { FinanceExpensesService } from '../finance/finance-expenses.service';
import { financeToday } from '../finance/finance-period';
import { FinanceTaxYearDataService } from '../finance/finance-tax-year-data.service';
import { FinanceTaxService } from '../finance/finance-tax.service';
import { reportingPeriodsOf } from '../finance/tax-year';

import { AccountingCogsService } from './accounting-cogs.service';
import { AccountingManualOperationsService } from './accounting-manual-operations.service';
import { accountingTaxOf, accountingTaxYearOf, orderTaxItemOf } from './accounting-tax';
import { AccountingTaxSettingsService } from './accounting-tax-settings.service';
import { AccountingService } from './accounting.service';

const DAY_MS = 86_400_000;
const moscowStart = (day: string) => new Date(`${day}T00:00:00+03:00`);

/** Налог «Финучёта» за год с настройками, под которыми он посчитан. */
export interface IAccountingTaxYearReport extends IAccountingTaxYear {
  year: number;
  settings: ITaxSettings;
  /** Налоговые настройки продавец не сохранял — действует умолчание. */
  taxIsDefault: boolean;
  hasStaff: boolean;
  baseRule: ITaxBaseRuleSnapshot;
  /** Площадки, чьи журналы вошли в базу. */
  marketplaces: TFinanceMarketplace[];
  /** null — строки года в таблице параметров нет. */
  params: ITaxYearParamsRow | null;
  reductions: ITaxReduction[];
}

/** Всё, из чего считается налог окна: журнал всех площадок, ручные, настройки. */
interface ITaxSources {
  marketplaces: TFinanceMarketplace[];
  journal: ITaxJournalOperation[];
  /** Сырые операции по площадке — для себестоимости v2. */
  raw: Map<TFinanceMarketplace, IPnlOperation[]>;
  manual: ITaxManualOperation[];
  settings: ITaxSettings;
  taxIsDefault: boolean;
  hasStaff: boolean;
  baseRule: ITaxBaseRuleSnapshot;
  /** Режим Б — себестоимость по партиям FIFO; нет — режим А (TASK-215). */
  lotCostOf: TOrderLotCostOf | undefined;
}

function journalOperationOf(
  op: IPnlOperation,
  marketplace: TFinanceMarketplace,
): ITaxJournalOperation {
  return {
    id: op.id,
    marketplace,
    article: op.article,
    subArticle: op.subArticle ?? null,
    amountKopecks: op.amountKopecks,
    accruedDay: financeToday(op.accruedAt),
    paidDay: op.paidAt ? financeToday(op.paidAt) : null,
  };
}

/**
 * Налог нового учёта (ТЗ п.6, TASK-221). Читает журнал всех площадок аккаунта,
 * ручные операции, налоговые настройки (`FinanceTaxService` — те же, что у
 * «Налогов»), правило агентской базы, опер. расходы и себестоимость v2; считает
 * чистыми `accountingTaxOf` / `accountingTaxYearOf`. Текущий налог P&L и
 * налоговый модуль ИП отсюда не зовутся и не меняются.
 */
@Injectable()
export class AccountingTaxService {
  constructor(
    private readonly accounting: AccountingService,
    private readonly operations: FinanceOperationRepository,
    private readonly manual: AccountingManualOperationsService,
    private readonly taxes: FinanceTaxService,
    private readonly taxYearData: FinanceTaxYearDataService,
    private readonly purchases: FinancePurchaseRepository,
    private readonly expenses: FinanceExpensesService,
    private readonly cogs: AccountingCogsService,
    private readonly baseRules: AccountingTaxSettingsService,
  ) {}

  /** Налог произвольного периода — основа оценки налога на заказ. */
  async period(
    telegramUserId: string,
    features: Readonly<Record<string, boolean>>,
    period: IFinancePeriod,
  ): Promise<IAccountingTax> {
    const sources = await this.sources(telegramUserId, features, period);
    return this.taxOf(telegramUserId, sources, period);
  }

  /**
   * Налог периода как общий расход для распределения по заказам (TASK-219);
   * `null` — налога нет. Зовёт сервис карточки (TASK-222).
   */
  async orderTaxItem(
    telegramUserId: string,
    features: Readonly<Record<string, boolean>>,
    period: IFinancePeriod,
  ): Promise<IStoreCostItem | null> {
    return orderTaxItemOf(await this.period(telegramUserId, features, period));
  }

  /**
   * Год по отчётным периодам нарастающим итогом: начислено, авансы, уменьшение
   * на взносы, уплачено и остаток. Журнал читается один раз на окно с 1 января
   * по конец последнего начавшегося периода; периоды считаются по очереди.
   */
  async year(
    telegramUserId: string,
    features: Readonly<Record<string, boolean>>,
    year: number,
    now: Date = new Date(),
  ): Promise<IAccountingTaxYearReport> {
    const today = financeToday(now);
    const yearFrom = `${year}-01-01`;
    const yearTo = `${year}-12-31`;
    const ranges = reportingPeriodsOf(year, today);
    const window = { from: yearFrom, to: ranges.length ? ranges[ranges.length - 1].to : yearFrom };

    const [sources, params, reductions, payments, reconciliations] = await Promise.all([
      this.sources(telegramUserId, features, window),
      this.taxYearData.params(year),
      this.taxYearData.reductionsBetween(telegramUserId, yearFrom, yearTo),
      this.purchases.taxPaymentsBetween(telegramUserId, yearFrom, yearTo),
      this.taxYearData.reconciliations(telegramUserId, year),
    ]);

    const periods: IAccountingTaxYearPeriod[] = [];
    for (const range of ranges) {
      const accounting = await this.taxOf(telegramUserId, sources, {
        from: range.from,
        to: range.to,
      });
      periods.push({ ...range, accounting });
    }

    const result = accountingTaxYearOf({
      year,
      today,
      settings: sources.settings,
      hasStaff: sources.hasStaff,
      params,
      periods,
      reductions,
      payments: payments.map((p) => ({ paidDay: p.paidDay, amountKopecks: p.amountKopecks })),
      reconciliations,
    });
    return {
      ...result,
      year,
      settings: sources.settings,
      taxIsDefault: sources.taxIsDefault,
      hasStaff: sources.hasStaff,
      baseRule: sources.baseRule,
      marketplaces: sources.marketplaces,
      params,
      reductions,
    };
  }

  private async taxOf(
    telegramUserId: string,
    sources: ITaxSources,
    period: IFinancePeriod,
  ): Promise<IAccountingTax> {
    const withExpenses = sources.settings.regime === 'usn_income_minus_expenses';
    const opex = withExpenses
      ? (await this.expenses.allocatedFor(telegramUserId, period)).totalKopecks
      : 0;
    let cogs = null;
    if (withExpenses) {
      cogs = { kopecks: 0, unknown: { count: 0, operationIds: [] as string[] } };
      // По очереди: каждая площадка — свои запросы строк заказов и товаров.
      for (const [marketplace, ops] of sources.raw) {
        const part = await this.cogs.cogsOf(
          telegramUserId,
          marketplace,
          ops,
          period,
          sources.lotCostOf,
        );
        cogs.kopecks += part.kopecks;
        cogs.unknown.count += part.unknown.count;
        cogs.unknown.operationIds.push(...part.unknown.operationIds);
      }
    }
    return accountingTaxOf({
      settings: sources.settings,
      rule: sources.baseRule.rule,
      period,
      journal: sources.journal,
      manual: sources.manual,
      opexKopecks: opex,
      cogs,
    });
  }

  private async sources(
    telegramUserId: string,
    features: Readonly<Record<string, boolean>>,
    window: IFinancePeriod,
  ): Promise<ITaxSources> {
    const [marketplaces, snapshot, baseRule, manualRows] = await Promise.all([
      this.accounting.marketplacesOf(telegramUserId, features),
      this.taxes.snapshot(telegramUserId),
      this.baseRules.snapshot(telegramUserId),
      this.manual.liveFor(telegramUserId, window),
    ]);
    const from = moscowStart(window.from);
    const to = new Date(moscowStart(window.to).getTime() + DAY_MS);
    const raw = new Map<TFinanceMarketplace, IPnlOperation[]>();
    const journal: ITaxJournalOperation[] = [];
    // По очереди, как `FinanceTaxYearService`: запрос журнала окна на площадку.
    for (const marketplace of marketplaces) {
      const ops = await this.operations.liveForPnl(telegramUserId, from, to, marketplace);
      raw.set(marketplace, ops);
      for (const op of ops) journal.push(journalOperationOf(op, marketplace));
    }
    const enabled = new Set(marketplaces);
    const manual: ITaxManualOperation[] = manualRows
      .filter((row) => enabled.has(row.marketplace))
      .map((row) => ({
        id: row.id,
        marketplace: row.marketplace,
        article: row.article,
        subArticle: row.subArticle ?? null,
        amountKopecks: row.amountKopecks,
        accruedOn: row.accruedOn,
      }));
    return {
      marketplaces,
      journal,
      raw,
      manual,
      settings: snapshot.settings,
      taxIsDefault: snapshot.isDefault,
      hasStaff: snapshot.hasStaff,
      baseRule,
      // Режим Б — одно FIFO на все площадки (склад общий); нужно только вычету.
      lotCostOf:
        snapshot.settings.regime === 'usn_income_minus_expenses'
          ? await this.cogs.lotCostOf(telegramUserId, features)
          : undefined,
    };
  }
}
