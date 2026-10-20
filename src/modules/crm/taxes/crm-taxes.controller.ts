import type { ICrmTaxesView, ICrmTaxReductions } from './crm-taxes.domain';

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';

import { isUuid } from '../../finance/expense.domain';
import {
  FinanceTaxYearDataService,
  TaxReductionNotFoundError,
  TaxYearValidationError,
} from '../../finance/finance-tax-year-data.service';
import { FinanceTaxService, TaxSettingsValidationError } from '../../finance/finance-tax.service';
import { isTaxYearInRange } from '../../finance/tax-year.domain';
import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { moscowDay } from '../../yandex/reports/moscow-day';
import { RequireFeature } from '../crm-auth.decorators';
import { CrmJwtGuard, IRequestWithCrmUser } from '../crm-jwt.guard';
import { bodyObject } from '../expenses/crm-expenses.domain';

import {
  INVALID_TAX_SETTING,
  INVALID_TAX_YEAR_INPUT,
  TAX_REDUCTION_NOT_FOUND,
  TAX_YEAR_INVALID_TEXT,
  toCrmTaxesView,
  toCrmTaxReductions,
} from './crm-taxes.domain';

/** Ошибки ввода вкладки «Год» → 400 с полем, «нет такого уменьшения» → 404. */
function rethrowTaxYear(error: unknown): never {
  if (error instanceof TaxYearValidationError || error instanceof TaxSettingsValidationError) {
    throw new BadRequestException({
      statusCode: 400,
      code: INVALID_TAX_YEAR_INPUT,
      field: error.field,
      message: error.message,
    });
  }
  if (error instanceof TaxReductionNotFoundError) {
    throw new NotFoundException({
      statusCode: 404,
      code: TAX_REDUCTION_NOT_FOUND,
      message: error.message,
    });
  }
  throw error;
}

const reductionNotFound = () =>
  new NotFoundException({
    statusCode: 404,
    code: TAX_REDUCTION_NOT_FOUND,
    message: 'Уменьшение не найдено',
  });

/**
 * «Налоги» CRM (TASK-123): режим, ставка и дата признания дохода. Полный адрес
 * — /api/crm/ym/taxes. Раздел аккаунта, только CRM (решение `taxes_crm_only`),
 * целиком под фичей `taxes`. Запись отвечает полным видом — форма показывает
 * то, что правда сохранено.
 *
 * Вкладка «Год» (TASK-146): работники, уменьшения и сверка. Расчёт года —
 * kind `taxes:year`. `@RequireFeature` метода перекрывает классовый
 * (`getAllAndOverride`), поэтому `taxes` повторён рядом с `tax_year`.
 */
@Controller('crm/ym/taxes')
@UseGuards(CrmJwtGuard)
@RequireFeature(FEATURE.TAXES)
export class CrmTaxesController {
  constructor(
    private readonly taxes: FinanceTaxService,
    private readonly taxYear: FinanceTaxYearDataService,
  ) {}

  @Get()
  async view(@Req() request: IRequestWithCrmUser): Promise<ICrmTaxesView> {
    return toCrmTaxesView(await this.taxes.snapshot(request.crmUser.telegramUserId));
  }

  @Put()
  async update(@Req() request: IRequestWithCrmUser, @Body() body: unknown): Promise<ICrmTaxesView> {
    try {
      const snapshot = await this.taxes.update(request.crmUser.telegramUserId, bodyObject(body));
      return toCrmTaxesView(snapshot);
    } catch (error) {
      if (error instanceof TaxSettingsValidationError) {
        throw new BadRequestException({
          statusCode: 400,
          code: INVALID_TAX_SETTING,
          field: error.field,
          message: error.message,
        });
      }
      throw error;
    }
  }

  /** Есть ли работники — от этого лимит уменьшения налога на взносы. */
  @Put('staff')
  @RequireFeature(FEATURE.TAXES, FEATURE.TAX_YEAR)
  async staff(
    @Req() request: IRequestWithCrmUser,
    @Body() body: unknown,
  ): Promise<{ hasStaff: boolean }> {
    try {
      const snapshot = await this.taxes.setStaff(
        request.crmUser.telegramUserId,
        bodyObject(body).hasStaff,
      );
      return { hasStaff: snapshot.hasStaff };
    } catch (error) {
      rethrowTaxYear(error);
    }
  }

  @Get('reductions')
  @RequireFeature(FEATURE.TAXES, FEATURE.TAX_YEAR)
  async reductions(@Req() request: IRequestWithCrmUser): Promise<ICrmTaxReductions> {
    return toCrmTaxReductions(await this.taxYear.reductions(request.crmUser.telegramUserId));
  }

  @Post('reductions')
  @RequireFeature(FEATURE.TAXES, FEATURE.TAX_YEAR)
  async createReduction(
    @Req() request: IRequestWithCrmUser,
    @Body() body: unknown,
  ): Promise<ICrmTaxReductions> {
    const uid = request.crmUser.telegramUserId;
    try {
      await this.taxYear.createReduction(uid, bodyObject(body));
    } catch (error) {
      rethrowTaxYear(error);
    }
    return toCrmTaxReductions(await this.taxYear.reductions(uid));
  }

  @Put('reductions/:id')
  @RequireFeature(FEATURE.TAXES, FEATURE.TAX_YEAR)
  async updateReduction(
    @Req() request: IRequestWithCrmUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ICrmTaxReductions> {
    if (!isUuid(id)) throw reductionNotFound();
    const uid = request.crmUser.telegramUserId;
    try {
      await this.taxYear.updateReduction(uid, id, bodyObject(body));
    } catch (error) {
      rethrowTaxYear(error);
    }
    return toCrmTaxReductions(await this.taxYear.reductions(uid));
  }

  @Delete('reductions/:id')
  @RequireFeature(FEATURE.TAXES, FEATURE.TAX_YEAR)
  async removeReduction(
    @Req() request: IRequestWithCrmUser,
    @Param('id') id: string,
  ): Promise<ICrmTaxReductions> {
    if (!isUuid(id)) throw reductionNotFound();
    const uid = request.crmUser.telegramUserId;
    try {
      await this.taxYear.removeReduction(uid, id);
    } catch (error) {
      rethrowTaxYear(error);
    }
    return toCrmTaxReductions(await this.taxYear.reductions(uid));
  }

  /** Сверка отчётного периода с бухгалтерией; пересчёт года — повтор kind-а. */
  @Put('reconciliations/:year/:period')
  @RequireFeature(FEATURE.TAXES, FEATURE.TAX_YEAR)
  async reconcile(
    @Req() request: IRequestWithCrmUser,
    @Param('year') yearParam: string,
    @Param('period') period: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const year = Number(yearParam);
    if (!isTaxYearInRange(year, moscowDay().year)) {
      throw new BadRequestException({
        statusCode: 400,
        code: INVALID_TAX_YEAR_INPUT,
        field: 'year',
        message: TAX_YEAR_INVALID_TEXT,
      });
    }
    try {
      await this.taxYear.saveReconciliation(
        request.crmUser.telegramUserId,
        year,
        period,
        bodyObject(body),
      );
    } catch (error) {
      rethrowTaxYear(error);
    }
    return { ok: true };
  }
}
