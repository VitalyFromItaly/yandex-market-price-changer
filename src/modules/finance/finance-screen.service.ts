import type { IFinanceScreenMonth, IFinanceScreenOperation } from './finance-screen';
import type { IFinanceOriginalFile } from '../../database/postgres/repositories/finance-document.repository';
import type { TFinancePeriodRow } from '../../database/postgres/repositories/finance-period.repository';

import { Injectable } from '@nestjs/common';

import {
  FinanceAnomalyRepository,
  MAX_ANOMALY_REVIEW_KEYS,
} from '../../database/postgres/repositories/finance-anomaly.repository';
import { FinanceCorrectionRepository } from '../../database/postgres/repositories/finance-correction.repository';
import { FinanceDiscrepancyRepository } from '../../database/postgres/repositories/finance-discrepancy.repository';
import { FinanceDocumentRepository } from '../../database/postgres/repositories/finance-document.repository';
import { FinanceOperationRepository } from '../../database/postgres/repositories/finance-operation.repository';
import { FinancePeriodRepository } from '../../database/postgres/repositories/finance-period.repository';

import { isUuid } from './expense.domain';
import { financePeriodKey, financeToday, YM_NETTING_REPORT_TYPE } from './finance-period';
import { MAX_SCREEN_OPERATION_IDS, screenMonths } from './finance-screen';

/** Запрос экрана не годится — CRM отвечает 400 под полем `field`. */
export class FinanceScreenValidationError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

export interface IFinanceScreenMonthState extends IFinanceScreenMonth {
  /** Строка `finance_periods`; null — журнал за месяц не загружался. */
  state: TFinancePeriodRow | null;
}

export interface IFinanceScreenPage {
  limit?: number;
  skip?: number;
}

/**
 * Данные экрана «Финансы» CRM, кроме P&L и ДДС (те — `FinanceService` и
 * `FinanceCashflowService`): месяцы со статусом, раскрытие статьи до операций,
 * оригинал отчёта, расхождения и корректировки месяца. Только Postgres; каждый
 * запрос — в скоупе продавца, потому что id приходят из браузера.
 */
@Injectable()
export class FinanceScreenService {
  constructor(
    private readonly operations: FinanceOperationRepository,
    private readonly documents: FinanceDocumentRepository,
    private readonly periods: FinancePeriodRepository,
    private readonly discrepancyRepo: FinanceDiscrepancyRepository,
    private readonly correctionRepo: FinanceCorrectionRepository,
    private readonly anomalyRepo: FinanceAnomalyRepository,
  ) {}

  async months(
    telegramUserId: string,
    now: Date = new Date(),
  ): Promise<IFinanceScreenMonthState[]> {
    const rows = await this.periods.listByUsers([telegramUserId]);
    const byKey = new Map<string, TFinancePeriodRow>();
    for (const row of rows) {
      if (row.marketplace === 'ym' && row.reportType === YM_NETTING_REPORT_TYPE)
        byKey.set(row.periodKey, row);
    }
    return screenMonths(financeToday(now)).map((month) => ({
      ...month,
      state: byKey.get(periodKeyOf(month.period)) ?? null,
    }));
  }

  /** Операции статьи страницей id — сумма раскрытия равна сумме статьи по построению. */
  async operationsByIds(telegramUserId: string, ids: unknown): Promise<IFinanceScreenOperation[]> {
    if (!Array.isArray(ids) || !ids.length) {
      throw new FinanceScreenValidationError('ids', 'Не переданы операции');
    }
    if (ids.length > MAX_SCREEN_OPERATION_IDS) {
      throw new FinanceScreenValidationError(
        'ids',
        `Не больше ${MAX_SCREEN_OPERATION_IDS} операций за запрос`,
      );
    }
    // Мусор вместо uuid Postgres встречает ошибкой синтаксиса — 400 стал бы 500.
    if (!ids.every(isUuid)) throw new FinanceScreenValidationError('ids', 'Неверный id операции');
    return this.operations.byIds(telegramUserId, ids);
  }

  /** Оригинал версии отчёта; null — нет, чужой или не сохранён (больше потолка). */
  async original(telegramUserId: string, documentId: string): Promise<IFinanceOriginalFile | null> {
    if (!isUuid(documentId)) return null;
    return this.documents.originalFile(telegramUserId, documentId);
  }

  async discrepancies(
    telegramUserId: string,
    month: IFinanceScreenMonth,
    page: IFinanceScreenPage,
  ) {
    return this.discrepancyRepo.list({
      telegramUserId,
      periodKey: periodKeyOf(month.period),
      ...page,
    });
  }

  /**
   * Аномалии месяца (TASK-149) и когда месяц проверялся: `checkedAt: null` —
   * детектор его не видел, и пустой список тогда не значит «всё чисто».
   */
  async anomalies(
    telegramUserId: string,
    month: IFinanceScreenMonth,
    page: IFinanceScreenPage & { unreviewedOnly?: boolean },
  ) {
    const scope = {
      marketplace: 'ym' as const,
      telegramUserId,
      periodKey: periodKeyOf(month.period),
    };
    const [list, checkedAt] = await Promise.all([
      this.anomalyRepo.list({ telegramUserId, periodKey: scope.periodKey, ...page }),
      this.anomalyRepo.checkedAt(scope),
    ]);
    return { ...list, checkedAt };
  }

  /** Отметить «просмотрено» или снять; чужие и выдуманные ключи молча не находятся. */
  async reviewAnomalies(telegramUserId: string, keys: unknown, reviewed: unknown): Promise<number> {
    if (
      !Array.isArray(keys) ||
      !keys.length ||
      keys.length > MAX_ANOMALY_REVIEW_KEYS ||
      !keys.every((key) => typeof key === 'string' && key.length > 0 && key.length <= 1000)
    ) {
      throw new FinanceScreenValidationError(
        'keys',
        `Нужен список ключей аномалий: от 1 до ${MAX_ANOMALY_REVIEW_KEYS}`,
      );
    }
    if (typeof reviewed !== 'boolean') {
      throw new FinanceScreenValidationError('reviewed', 'reviewed — true или false');
    }
    return this.anomalyRepo.setReviewed('ym', telegramUserId, keys as string[], reviewed);
  }

  async corrections(telegramUserId: string, month: IFinanceScreenMonth, page: IFinanceScreenPage) {
    return this.correctionRepo.list({
      telegramUserId,
      periodKey: periodKeyOf(month.period),
      ...page,
    });
  }
}

function periodKeyOf(period: IFinanceScreenMonth['period']): string {
  return financePeriodKey(YM_NETTING_REPORT_TYPE, period);
}
