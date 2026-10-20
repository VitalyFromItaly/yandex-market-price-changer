import type { ICrmExpenseAllocationView, ICrmExpensesView } from './crm-expenses.domain';

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import {
  ExpenseCategoryInUseError,
  ExpenseNotFoundError,
  ExpenseValidationError,
  FinanceExpensesService,
} from '../../finance/finance-expenses.service';
import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { RequireFeature } from '../crm-auth.decorators';
import { CrmJwtGuard, IRequestWithCrmUser } from '../crm-jwt.guard';

import {
  CATEGORY_IN_USE,
  EXPENSE_NOT_FOUND,
  INVALID_EXPENSE,
  bodyObject,
  toCrmAllocationView,
  toCrmExpensesView,
} from './crm-expenses.domain';

/**
 * «Расходы» CRM (TASK-121): операционные расходы бизнеса продавца. Полный адрес
 * — /api/crm/ym/expenses. Раздел аккаунта, не магазина (решение
 * `expenses_crm_account_section`), целиком под фичей `expenses`.
 *
 * Мутации отвечают полным видом раздела: форма перерисовывает таблицу тем, что
 * правда записано, а не своей копией. `/allocation` — распределение на период;
 * пока движка P&L нет (TASK-120), это и есть место, где видно, сколько расходов
 * ляжет в период.
 */
@Controller('crm/ym/expenses')
@UseGuards(CrmJwtGuard)
@RequireFeature(FEATURE.EXPENSES)
export class CrmExpensesController {
  constructor(private readonly expenses: FinanceExpensesService) {}

  @Get()
  async view(@Req() request: IRequestWithCrmUser): Promise<ICrmExpensesView> {
    return this.viewOf(request);
  }

  @Get('allocation')
  async allocation(
    @Req() request: IRequestWithCrmUser,
    @Query('from') from: unknown,
    @Query('to') to: unknown,
  ): Promise<ICrmExpenseAllocationView> {
    const period = { from: String(from ?? ''), to: String(to ?? '') };
    const userId = request.crmUser.telegramUserId;
    const [allocation, snapshot] = await this.guarded(() =>
      Promise.all([this.expenses.allocatedFor(userId, period), this.expenses.snapshot(userId)]),
    );
    return toCrmAllocationView(period, allocation, snapshot.categories);
  }

  @Post()
  async create(
    @Req() request: IRequestWithCrmUser,
    @Body() body: unknown,
  ): Promise<ICrmExpensesView> {
    await this.guarded(() =>
      this.expenses.create(request.crmUser.telegramUserId, bodyObject(body)),
    );
    return this.viewOf(request);
  }

  @Put(':id')
  async update(
    @Req() request: IRequestWithCrmUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ICrmExpensesView> {
    await this.guarded(() =>
      this.expenses.update(request.crmUser.telegramUserId, id, bodyObject(body)),
    );
    return this.viewOf(request);
  }

  @Delete(':id')
  async remove(
    @Req() request: IRequestWithCrmUser,
    @Param('id') id: string,
  ): Promise<ICrmExpensesView> {
    await this.guarded(() => this.expenses.remove(request.crmUser.telegramUserId, id));
    return this.viewOf(request);
  }

  @Post('categories')
  async addCategory(
    @Req() request: IRequestWithCrmUser,
    @Body() body: unknown,
  ): Promise<ICrmExpensesView> {
    await this.guarded(() =>
      this.expenses.addCategory(request.crmUser.telegramUserId, bodyObject(body).name),
    );
    return this.viewOf(request);
  }

  @Delete('categories/:id')
  async removeCategory(
    @Req() request: IRequestWithCrmUser,
    @Param('id') id: string,
  ): Promise<ICrmExpensesView> {
    await this.guarded(() => this.expenses.removeCategory(request.crmUser.telegramUserId, id));
    return this.viewOf(request);
  }

  private async viewOf(request: IRequestWithCrmUser): Promise<ICrmExpensesView> {
    return toCrmExpensesView(await this.expenses.snapshot(request.crmUser.telegramUserId));
  }

  /** Ошибки сервиса → коды раздела; прочее уходит общему фильтру как есть. */
  private async guarded<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof ExpenseValidationError) {
        throw new BadRequestException({
          statusCode: 400,
          code: INVALID_EXPENSE,
          field: error.field,
          message: error.message,
        });
      }
      if (error instanceof ExpenseNotFoundError) {
        throw new NotFoundException({
          statusCode: 404,
          code: EXPENSE_NOT_FOUND,
          message: error.message,
        });
      }
      if (error instanceof ExpenseCategoryInUseError) {
        throw new ConflictException({
          statusCode: 409,
          code: CATEGORY_IN_USE,
          used: error.used,
          message: error.message,
        });
      }
      throw error;
    }
  }
}
