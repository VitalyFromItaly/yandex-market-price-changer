import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { FinanceCorrectionRepository } from '../../database/postgres/repositories/finance-correction.repository';
import { FinanceDiscrepancyRepository } from '../../database/postgres/repositories/finance-discrepancy.repository';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';

import { RECONCILE_KIND_LABEL } from './finance-reconcile';
import { FinanceTaxYearDataService, TaxYearValidationError } from './finance-tax-year-data.service';

/** Число из query: мусор — умолчание, а не NaN в запросе к базе. */
const intOf = (value: string | undefined): number | undefined => {
  const n = Number(value);
  return value !== undefined && Number.isFinite(n) ? Math.trunc(n) : undefined;
};

/**
 * Корректировки и находки сверки финансового журнала для владельца:
 * `GET /api/finance/corrections?telegramUserId=&limit=&skip=`,
 * `GET /api/finance/discrepancies?telegramUserId=&periodKey=&limit=&skip=`,
 * `GET /api/finance/tax-years`, `PUT /api/finance/tax-years/:year`.
 *
 * Гвард на весь контроллер (довод LogsController). Ответ собирается
 * перечислением полей: сырая строка отчёта и служебные поля наружу не едут.
 * Экрана в панели нет; продавцу то же показывает раздел CRM «Финансы» (TASK-124).
 */
@Controller('finance')
@UseGuards(AdminJwtGuard)
export class FinanceAdminController {
  constructor(
    private readonly corrections: FinanceCorrectionRepository,
    private readonly discrepancies: FinanceDiscrepancyRepository,
    private readonly taxYears: FinanceTaxYearDataService,
  ) {}

  /**
   * Параметры налоговых лет (TASK-146, решение `tax_year_params_global_admin`):
   * лимит УСН, порог НДС, взносы, предельные ставки — одна строка на год для
   * всех продавцов. Смена года — PUT новой строки, без деплоя.
   */
  @Get('tax-years')
  async taxYearList() {
    return { items: await this.taxYears.years() };
  }

  /** Строка года целиком: поле не прислано — «не задано». Суммы — рубли, доли — проценты. */
  @Put('tax-years/:year')
  async saveTaxYear(@Param('year') year: string, @Body() body: unknown) {
    try {
      const input = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      return await this.taxYears.saveParams(Number(year), input);
    } catch (error) {
      if (error instanceof TaxYearValidationError) {
        throw new BadRequestException({
          statusCode: 400,
          field: error.field,
          message: error.message,
        });
      }
      throw error;
    }
  }

  @Get('corrections')
  async list(
    @Query('telegramUserId') telegramUserId?: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
  ) {
    const { items, total } = await this.corrections.list({
      telegramUserId: telegramUserId || undefined,
      limit: intOf(limit),
      skip: intOf(skip),
    });
    return {
      total,
      items: items.map((c) => ({
        telegramUserId: c.telegramUserId,
        periodKey: c.periodKey,
        documentVersion: c.documentVersion,
        kind: c.kind,
        before: c.before,
        after: c.after,
        createdAt: c.createdAt,
      })),
    };
  }

  /** Находки сверки с заказами (TASK-113) — причина словами и ссылки на операции. */
  @Get('discrepancies')
  async discrepancyList(
    @Query('telegramUserId') telegramUserId?: string,
    @Query('periodKey') periodKey?: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
  ) {
    const { items, total } = await this.discrepancies.list({
      telegramUserId: telegramUserId || undefined,
      periodKey: periodKey || undefined,
      limit: intOf(limit),
      skip: intOf(skip),
    });
    return {
      total,
      items: items.map((d) => ({
        telegramUserId: d.telegramUserId,
        periodKey: d.periodKey,
        kind: d.kind,
        kindLabel: RECONCILE_KIND_LABEL[d.kind],
        orderId: d.orderId,
        bankOrderId: d.bankOrderId,
        operationIds: d.operationIds,
        operationCount: d.operationCount,
        expectedKopecks: d.expectedKopecks,
        actualKopecks: d.actualKopecks,
        detail: d.detail,
        createdAt: d.createdAt,
      })),
    };
  }
}
