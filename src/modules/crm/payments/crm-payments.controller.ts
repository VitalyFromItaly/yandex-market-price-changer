import type { ICrmPaymentsOptions } from './crm-payments.domain';

import { Controller, Get, UseGuards } from '@nestjs/common';

import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { RequireFeature } from '../crm-auth.decorators';
import { CrmJwtGuard } from '../crm-jwt.guard';

import { paymentsOptions } from './crm-payments.domain';

/**
 * Опции формы «Платежей»: /api/crm/ym/payments/options. Сам отчёт — фоновая
 * задача `payments:report` через /api/crm/ym/jobs. Опции отдаёт сервер из
 * констант домена, чтобы веб не держал копию таблицы периодов.
 */
@Controller('crm/ym/payments')
@UseGuards(CrmJwtGuard)
@RequireFeature(FEATURE.PAYMENTS_REPORT)
export class CrmPaymentsController {
  @Get('options')
  options(): ICrmPaymentsOptions {
    return paymentsOptions();
  }
}
