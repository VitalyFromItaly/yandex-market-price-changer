import type { ICrmPurchasesView } from './crm-purchases.domain';

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

import {
  FinancePurchasesService,
  PurchaseNotFoundError,
  PurchaseValidationError,
} from '../../finance/finance-purchases.service';
import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { RequireFeature } from '../crm-auth.decorators';
import { CrmJwtGuard, IRequestWithCrmUser } from '../crm-jwt.guard';
import { bodyObject } from '../expenses/crm-expenses.domain';

import { INVALID_PURCHASE, PURCHASE_NOT_FOUND, toCrmPurchasesView } from './crm-purchases.domain';

/**
 * «Закупки» CRM (TASK-122): закупки партий и уплаченные налоги. Полный адрес —
 * /api/crm/ym/purchases. Раздел аккаунта рядом с «Расходами» (решение
 * `purchases_crm_section`), целиком под фичей `purchases`. ДДС, выплаты и «к
 * получению» переехали в «Финансы» (TASK-124, `finance_crm_cashflow_moved`).
 *
 * Мутации отвечают полным видом раздела.
 */
@Controller('crm/ym/purchases')
@UseGuards(CrmJwtGuard)
@RequireFeature(FEATURE.PURCHASES)
export class CrmPurchasesController {
  constructor(private readonly purchases: FinancePurchasesService) {}

  @Get()
  async view(@Req() request: IRequestWithCrmUser): Promise<ICrmPurchasesView> {
    return this.viewOf(request);
  }

  @Post()
  async create(
    @Req() request: IRequestWithCrmUser,
    @Body() body: unknown,
  ): Promise<ICrmPurchasesView> {
    await this.guarded(() =>
      this.purchases.createPurchase(request.crmUser.telegramUserId, bodyObject(body)),
    );
    return this.viewOf(request);
  }

  @Post('tax-payments')
  async createTaxPayment(
    @Req() request: IRequestWithCrmUser,
    @Body() body: unknown,
  ): Promise<ICrmPurchasesView> {
    await this.guarded(() =>
      this.purchases.createTaxPayment(request.crmUser.telegramUserId, bodyObject(body)),
    );
    return this.viewOf(request);
  }

  @Put('tax-payments/:id')
  async updateTaxPayment(
    @Req() request: IRequestWithCrmUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ICrmPurchasesView> {
    await this.guarded(() =>
      this.purchases.updateTaxPayment(request.crmUser.telegramUserId, id, bodyObject(body)),
    );
    return this.viewOf(request);
  }

  @Delete('tax-payments/:id')
  async removeTaxPayment(
    @Req() request: IRequestWithCrmUser,
    @Param('id') id: string,
  ): Promise<ICrmPurchasesView> {
    await this.guarded(() => this.purchases.removeTaxPayment(request.crmUser.telegramUserId, id));
    return this.viewOf(request);
  }

  @Put(':id')
  async update(
    @Req() request: IRequestWithCrmUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ICrmPurchasesView> {
    await this.guarded(() =>
      this.purchases.updatePurchase(request.crmUser.telegramUserId, id, bodyObject(body)),
    );
    return this.viewOf(request);
  }

  @Delete(':id')
  async remove(
    @Req() request: IRequestWithCrmUser,
    @Param('id') id: string,
  ): Promise<ICrmPurchasesView> {
    await this.guarded(() => this.purchases.removePurchase(request.crmUser.telegramUserId, id));
    return this.viewOf(request);
  }

  private async viewOf(request: IRequestWithCrmUser): Promise<ICrmPurchasesView> {
    return toCrmPurchasesView(await this.purchases.snapshot(request.crmUser.telegramUserId));
  }

  /** Ошибки сервиса → коды раздела; прочее уходит общему фильтру как есть. */
  private async guarded<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof PurchaseValidationError) {
        throw new BadRequestException({
          statusCode: 400,
          code: INVALID_PURCHASE,
          field: error.field,
          message: error.message,
        });
      }
      if (error instanceof PurchaseNotFoundError) {
        throw new NotFoundException({
          statusCode: 404,
          code: PURCHASE_NOT_FOUND,
          message: error.message,
        });
      }
      throw error;
    }
  }
}
