import type {
  IAccountingReconcileAct,
  IAccountingReconcileOperation,
  IAccountingReconcileResult,
} from './accounting-reconcile.domain';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { IFinancePeriod } from '../finance/finance-period';

import { Injectable } from '@nestjs/common';

import { FinanceActServicesRepository } from '../../database/postgres/repositories/finance-act-services.repository';
import { FinanceDocumentRepository } from '../../database/postgres/repositories/finance-document.repository';
import { FinanceOperationRepository } from '../../database/postgres/repositories/finance-operation.repository';
import { FinanceOzonBalanceRepository } from '../../database/postgres/repositories/finance-ozon-balance.repository';
import { FinanceSyncRunRepository } from '../../database/postgres/repositories/finance-sync-run.repository';
import {
  FINANCE_REPORT_TYPE,
  financePeriodKey,
  financeToday,
  monthPeriod,
} from '../finance/finance-period';
import { isPeriodClosed } from '../finance/finance-period-status';
import { RECONCILE_ACCRUED_BEFORE_DAYS } from '../finance/finance-reconcile.service';
import { breakdownOf } from '../finance/operation-breakdown';

import { AccountingManualOperationsService } from './accounting-manual-operations.service';
import { reconcileV2 } from './accounting-reconcile.domain';
import { isAccountingSubArticle } from './accounting-sub-articles';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Как у текущей сверки: строки поручения и акта лежат и в отчёте M+1. */
const ACCRUED_AFTER_DAYS = 62;

/** «ГГГГ-ММ» → календарный месяц; мусор — null. */
export function parseReconcileMonth(value: unknown): IFinancePeriod | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return monthPeriod(Number(m[1]), month);
}

function shiftMonth(period: IFinancePeriod, shift: -1 | 1): IFinancePeriod {
  const [year, month] = period.from.split('-').map(Number);
  const index = year * 12 + (month - 1) + shift;
  return monthPeriod(Math.floor(index / 12), (index % 12) + 1);
}

const dayOf = (at: Date | null) => (at ? financeToday(at) : null);

/**
 * Сверка v2 «Финучёта» (ЯМ — TASK-226, Ozon/WB — TASK-227): собирает из базы
 * вход чистой `reconcileV2` — живые строки окна, ручные операции месяца, акты
 * месяца с листами отчёта услуг (только ЯМ), сальдо месяца (только Ozon),
 * загружен ли журнал месяца и соседей, «данные на». Только чтение: площадка не
 * зовётся, `finance_periods`/`finance_discrepancies` не пишутся, текущая
 * `reconcile()` не меняется.
 */
@Injectable()
export class AccountingReconcileService {
  constructor(
    private readonly operations: FinanceOperationRepository,
    private readonly actServices: FinanceActServicesRepository,
    private readonly ozonBalances: FinanceOzonBalanceRepository,
    private readonly documents: FinanceDocumentRepository,
    private readonly syncRuns: FinanceSyncRunRepository,
    private readonly manual: AccountingManualOperationsService,
  ) {}

  async reconcile(
    telegramUserId: string,
    period: IFinancePeriod,
    now: Date = new Date(),
    marketplace: TFinanceMarketplace = 'ym',
  ): Promise<IAccountingReconcileResult> {
    const fromMs = Date.parse(`${period.from}T00:00:00+03:00`);
    const toMs = Date.parse(`${period.to}T23:59:59+03:00`);
    const periodKey = financePeriodKey(FINANCE_REPORT_TYPE[marketplace], period);
    const [journal, manual, actDays, month, prev, next, states, balance] = await Promise.all([
      this.operations.liveForAccountingReconcile(
        telegramUserId,
        new Date(fromMs - RECONCILE_ACCRUED_BEFORE_DAYS * DAY_MS),
        new Date(toMs + ACCRUED_AFTER_DAYS * DAY_MS),
        marketplace,
      ),
      this.manual.liveFor(telegramUserId, period),
      // Акты есть только у ЯМ.
      marketplace === 'ym'
        ? this.operations.actDaysOfPeriod(telegramUserId, periodKey, marketplace)
        : Promise.resolve([] as string[]),
      this.isImported(telegramUserId, period, marketplace),
      this.isImported(telegramUserId, shiftMonth(period, -1), marketplace),
      this.isImported(telegramUserId, shiftMonth(period, 1), marketplace),
      this.syncRuns.states(telegramUserId, [marketplace]),
      marketplace === 'ozon' ? this.ozonBalances.of(telegramUserId, period) : Promise.resolve(null),
    ]);
    const sheets = await this.actServices.sheetsByDays(telegramUserId, actDays);
    const acts: IAccountingReconcileAct[] = actDays.map((actDay) => ({
      actDay,
      totalKopecks: sheets.get(actDay)?.totalKopecks ?? null,
      sheets: sheets.get(actDay)?.sheets ?? null,
    }));

    const operations: IAccountingReconcileOperation[] = [
      ...journal.map(
        (row): IAccountingReconcileOperation => ({
          id: row.id,
          source: 'journal',
          orderId: row.orderId,
          article: row.article,
          subArticle: row.subArticle,
          amountKopecks: row.amountKopecks,
          accruedOn: financeToday(row.accruedAt),
          actDay: dayOf(row.actDate),
          bankOrderId: row.bankOrderId,
          bankSumKopecks: row.bankSumKopecks,
          paidOn: dayOf(row.paidAt),
          serviceName: row.serviceName,
          breakdown: breakdownOf(row.breakdown),
        }),
      ),
      ...manual
        .filter((row) => row.marketplace === marketplace)
        .map(
          (row): IAccountingReconcileOperation => ({
            id: row.id,
            source: 'manual',
            orderId: row.orderId,
            article: row.article,
            subArticle: isAccountingSubArticle(row.subArticle) ? row.subArticle : null,
            amountKopecks: row.amountKopecks,
            accruedOn: row.accruedOn,
            actDay: null,
            bankOrderId: null,
            bankSumKopecks: null,
            paidOn: null,
            serviceName: null,
          }),
        ),
    ];

    const successes = states
      .map((s) => s.lastSuccessAt)
      .filter((at): at is Date => at !== null)
      .sort((a, b) => b.getTime() - a.getTime());

    return reconcileV2({
      period,
      marketplace,
      balance,
      operations,
      acts,
      closed: isPeriodClosed(period.to, financeToday(now)),
      loaded: { month, prev, next },
      dataAsOf: successes[0] ?? null,
      now,
    });
  }

  /** Загружен ли журнал месяца — по типу отчёта площадки (файл WB «Продвижение» не в счёт). */
  private async isImported(
    telegramUserId: string,
    period: IFinancePeriod,
    marketplace: TFinanceMarketplace,
  ): Promise<boolean> {
    const latest = await this.documents.latest({
      marketplace,
      telegramUserId,
      reportType: FINANCE_REPORT_TYPE[marketplace],
      periodFrom: period.from,
      periodTo: period.to,
    });
    return latest?.status === 'imported';
  }
}
