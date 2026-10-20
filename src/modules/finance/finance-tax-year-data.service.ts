import type { ITaxYearReconciliation } from './tax-year';
import type {
  ITaxReconciliationValue,
  ITaxReductionValue,
  ITaxYearParams,
  TTaxReconciliationField,
  TTaxReductionField,
  TTaxYearParamField,
  TTaxYearPeriod,
} from './tax-year.domain';
import type {
  TFinanceTaxReductionRow,
  TFinanceTaxYearRow,
} from '../../database/postgres/repositories/finance-tax-year.repository';

import { Injectable } from '@nestjs/common';

import { FinanceTaxYearRepository } from '../../database/postgres/repositories/finance-tax-year.repository';

import {
  isTaxReductionKind,
  isTaxYearPeriod,
  validateTaxReconciliationInput,
  validateTaxReductionInput,
  validateTaxYearParamsInput,
} from './tax-year.domain';

/** Ввод налогового модуля не прошёл проверку — `field` говорит, под каким полем показать. */
export class TaxYearValidationError extends Error {
  constructor(
    readonly field: TTaxYearParamField | TTaxReductionField | TTaxReconciliationField | 'period',
    message: string,
  ) {
    super(message);
    this.name = 'TaxYearValidationError';
  }
}

/** Уменьшения с таким id у продавца нет (чужое — тоже «нет»). */
export class TaxReductionNotFoundError extends Error {
  constructor() {
    super('Уменьшение не найдено');
    this.name = 'TaxReductionNotFoundError';
  }
}

export interface ITaxReduction extends ITaxReductionValue {
  id: string;
}

export interface ITaxYearParamsRow extends ITaxYearParams {
  updatedAt: Date;
}

const paramsOf = (row: TFinanceTaxYearRow): ITaxYearParamsRow => ({
  year: row.year,
  usnIncomeLimitKopecks: row.usnIncomeLimitKopecks,
  vatThresholdKopecks: row.vatThresholdKopecks,
  insuranceFixedKopecks: row.insuranceFixedKopecks,
  insuranceExtraCapKopecks: row.insuranceExtraCapKopecks,
  reductionLimitWithStaffBasisPoints: row.reductionLimitWithStaffBasisPoints,
  maxRateUsnIncomeBasisPoints: row.maxRateUsnIncomeBasisPoints,
  maxRateUsnIncomeMinusExpensesBasisPoints: row.maxRateUsnIncomeMinusExpensesBasisPoints,
  sourceNote: row.sourceNote,
  updatedAt: row.updatedAt,
});

/** Битый вид в базе (правка руками) — строка пропускается, а не роняет расчёт года. */
const reductionOf = (row: TFinanceTaxReductionRow): ITaxReduction | null =>
  isTaxReductionKind(row.kind)
    ? {
        id: row.id,
        paidDay: row.paidDay,
        kind: row.kind,
        amountKopecks: row.amountKopecks,
        note: row.note,
      }
    : null;

/**
 * Данные налогового модуля ИП (TASK-146), которые вводятся руками: параметры
 * лет (админ), уменьшения и сверки (продавец). Только Postgres — довод
 * `FinanceTaxModule`; расчёт года — `FinanceTaxYearService`.
 */
@Injectable()
export class FinanceTaxYearDataService {
  constructor(private readonly repository: FinanceTaxYearRepository) {}

  async years(): Promise<ITaxYearParamsRow[]> {
    return (await this.repository.listYears()).map(paramsOf);
  }

  async params(year: number): Promise<ITaxYearParamsRow | null> {
    const row = await this.repository.findYear(year);
    return row ? paramsOf(row) : null;
  }

  /** Строка года целиком: незаданное поле — «не задано», а не «оставить прежнее». */
  async saveParams(year: number, input: Record<string, unknown>): Promise<ITaxYearParamsRow> {
    const checked = validateTaxYearParamsInput(year, input);
    if (checked.ok === false) throw new TaxYearValidationError(checked.field, checked.error);
    return paramsOf(await this.repository.upsertYear(checked.value));
  }

  async reductions(telegramUserId: string): Promise<ITaxReduction[]> {
    return (await this.repository.listReductions(telegramUserId)).map(reductionOf).filter(Boolean);
  }

  async reductionsBetween(
    telegramUserId: string,
    fromDay: string,
    toDay: string,
  ): Promise<ITaxReduction[]> {
    const rows = await this.repository.reductionsBetween(telegramUserId, fromDay, toDay);
    return rows.map(reductionOf).filter(Boolean);
  }

  async createReduction(telegramUserId: string, input: Record<string, unknown>): Promise<void> {
    await this.repository.createReduction(telegramUserId, this.checkedReduction(input));
  }

  async updateReduction(
    telegramUserId: string,
    id: string,
    input: Record<string, unknown>,
  ): Promise<void> {
    const row = await this.repository.updateReduction(
      telegramUserId,
      id,
      this.checkedReduction(input),
    );
    if (!row) throw new TaxReductionNotFoundError();
  }

  async removeReduction(telegramUserId: string, id: string): Promise<void> {
    if (!(await this.repository.removeReduction(telegramUserId, id)))
      throw new TaxReductionNotFoundError();
  }

  async reconciliations(telegramUserId: string, year: number): Promise<ITaxYearReconciliation[]> {
    const rows = await this.repository.reconciliations(telegramUserId, year);
    return rows
      .filter((row) => isTaxYearPeriod(row.period))
      .map((row) => ({
        period: row.period,
        accountantIncomeKopecks: row.accountantIncomeKopecks,
        accountantTaxKopecks: row.accountantTaxKopecks,
        checked: row.checked,
        note: row.note,
        checkedAt: row.checkedAt,
      }));
  }

  async saveReconciliation(
    telegramUserId: string,
    year: number,
    period: unknown,
    input: Record<string, unknown>,
  ): Promise<void> {
    if (!isTaxYearPeriod(period))
      throw new TaxYearValidationError('period', 'Неизвестный отчётный период');
    const checked = validateTaxReconciliationInput(input);
    if (checked.ok === false) throw new TaxYearValidationError(checked.field, checked.error);
    await this.repository.upsertReconciliation(
      telegramUserId,
      year,
      period as TTaxYearPeriod,
      checked.value as ITaxReconciliationValue,
    );
  }

  private checkedReduction(input: Record<string, unknown>): ITaxReductionValue {
    const checked = validateTaxReductionInput(input);
    if (checked.ok === false) throw new TaxYearValidationError(checked.field, checked.error);
    return checked.value;
  }
}
