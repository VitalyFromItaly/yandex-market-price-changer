import type { IAnomaly } from './finance-anomalies';
import type { IFinancePeriod } from './finance-period';
import type { IReconcileFinding } from './finance-reconcile';

import { Injectable, Logger } from '@nestjs/common';

import { FinanceAnomalyRepository } from '../../database/postgres/repositories/finance-anomaly.repository';
import { FinanceDiscrepancyRepository } from '../../database/postgres/repositories/finance-discrepancy.repository';
import { FinanceOperationRepository } from '../../database/postgres/repositories/finance-operation.repository';

import { anomalyHistoryStart, countAnomaliesByKind, detectAnomalies } from './finance-anomalies';
import { assertFinancePeriod, financePeriodKey, YM_NETTING_REPORT_TYPE } from './finance-period';
import { FinanceService } from './finance.service';

export interface IFinanceAnomalyRun {
  periodKey: string;
  anomalies: IAnomaly[];
}

/** Начало московского дня `ГГГГ-ММ-ДД` как момент — правило `FinanceService`. */
const moscowStart = (day: string) => new Date(`${day}T00:00:00+03:00`);
const DAY_MS = 86_400_000;

/**
 * Детектор аномалий журнала (TASK-149): собирает входы и пишет список месяца.
 * Только Postgres и закуп из Mongo — Маркет не спрашивается, поэтому прогон
 * дешёвый и идёт после каждой ночной загрузки. Правила — `finance-anomalies.ts`.
 */
@Injectable()
export class FinanceAnomalyService {
  private readonly logger = new Logger(FinanceAnomalyService.name);

  constructor(
    private readonly finance: FinanceService,
    private readonly operations: FinanceOperationRepository,
    private readonly discrepancies: FinanceDiscrepancyRepository,
    private readonly anomalies: FinanceAnomalyRepository,
  ) {}

  /** Посчитать аномалии месяца, не записывая, — скрипт без `--write`. */
  async detect(
    telegramUserId: string,
    period: IFinancePeriod,
    now: Date = new Date(),
  ): Promise<IFinanceAnomalyRun> {
    if (!telegramUserId) throw new Error('Аномалии финансов без telegramUserId');
    assertFinancePeriod(period);
    const periodKey = financePeriodKey(YM_NETTING_REPORT_TYPE, period);
    const scope = { marketplace: 'ym' as const, telegramUserId, periodKey };

    // История комиссии и строки месяца — одним запросом; P&L месяца — тот же
    // `build`, что у «Финансов» (без плоской оценки — она ходит в Маркет).
    const [operations, report, findings] = await Promise.all([
      this.operations.liveForPnl(
        telegramUserId,
        moscowStart(anomalyHistoryStart(period)),
        new Date(moscowStart(period.to).getTime() + DAY_MS),
      ),
      this.finance.build(telegramUserId, period, now, { flat: false }),
      this.discrepancies.allOfPeriod(scope),
    ]);

    const anomalies = detectAnomalies({
      period,
      periodKey,
      operations,
      pnl: report.pnl,
      discrepancies: findings.map(
        (row): IReconcileFinding => ({
          kind: row.kind,
          orderId: row.orderId ?? undefined,
          bankOrderId: row.bankOrderId ?? undefined,
          operationIds: row.operationIds,
          operationCount: row.operationCount,
          expectedKopecks: row.expectedKopecks ?? undefined,
          actualKopecks: row.actualKopecks ?? undefined,
          detail: row.detail,
        }),
      ),
    });
    return { periodKey, anomalies };
  }

  /** Посчитать и заменить список месяца. Ошибки пробрасываются — решает вызывающий. */
  async detectPeriod(
    telegramUserId: string,
    period: IFinancePeriod,
    now: Date = new Date(),
  ): Promise<IFinanceAnomalyRun> {
    const run = await this.detect(telegramUserId, period, now);
    await this.anomalies.replacePeriod(
      { marketplace: 'ym', telegramUserId, periodKey: run.periodKey },
      run.anomalies,
      now,
    );
    this.logger.log(
      `Аномалии ${run.periodKey} продавца ${telegramUserId}: ${run.anomalies.length} ` +
        JSON.stringify(countAnomaliesByKind(run.anomalies)),
    );
    return run;
  }
}
