import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { PaymentsReportService } from '../../yandex/payments/payments-report.service';
import { paymentsRange } from '../../yandex/payments/payments.domain';
import { XLSX_TYPE } from '../jobs/crm-jobs.domain';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';

import { PAYMENTS_JOB_KIND, parsePaymentsParams, toCrmPaymentsView } from './crm-payments.domain';

/**
 * «Платежи» как фоновая задача CRM. `run` зовёт тот же
 * `PaymentsReportService.build`, что процессор бота; даты периода считаются
 * здесь, в момент выполнения, — в params едет только ключ пресета.
 */
@Injectable()
export class CrmPaymentsKinds implements OnModuleInit {
  constructor(
    private readonly registry: CrmJobsRegistry,
    private readonly payments: PaymentsReportService,
  ) {}

  onModuleInit(): void {
    this.registry.register(PAYMENTS_JOB_KIND, {
      features: [FEATURE.PAYMENTS_REPORT],
      run: (context) => this.run(context),
    });
  }

  async run(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    const period = parsePaymentsParams(context.params);
    const { file } = await this.payments.build(context.store, paymentsRange(period, now), now);

    return {
      data: toCrmPaymentsView(period, now, file?.filename ?? null),
      file: file ? { buffer: file.buffer, filename: file.filename, contentType: XLSX_TYPE } : null,
    };
  }
}
