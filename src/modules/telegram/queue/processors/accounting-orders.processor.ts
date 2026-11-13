import type { IAccountingOrdersSyncReport } from '../../../accounting/accounting-orders.service';
import type { IAccountingOrdersJob } from '../services/accounting-orders.scheduler';

import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

import { AccountingOrdersService } from '../../../accounting/accounting-orders.service';
import { ErrorReporter } from '../../../errors/error-reporter.service';
import { JOB_TYPES, QUEUE_NAMES } from '../../index';
import { AccountingOrdersScheduler } from '../services/accounting-orders.scheduler';

/**
 * Единственный обработчик очереди `accounting-orders` (TASK-210), concurrency 1:
 * Bull суммирует concurrency всех `@Process` очереди, а опросы продавцов друг
 * за другом не толпятся в квоте Маркета. Право перепроверяется в момент прохода:
 * фичу могли закрыть после постановки задачи.
 */
@Processor(QUEUE_NAMES.ACCOUNTING_ORDERS)
export class AccountingOrdersProcessor {
  private readonly logger = new Logger(AccountingOrdersProcessor.name);

  constructor(
    private readonly orders: AccountingOrdersService,
    private readonly scheduler: AccountingOrdersScheduler,
    private readonly errors: ErrorReporter,
  ) {}

  @Process({ name: JOB_TYPES.SYNC_ACCOUNTING_ORDERS, concurrency: 1 })
  async handle(
    job: Job<IAccountingOrdersJob>,
  ): Promise<IAccountingOrdersSyncReport | { skipped: 'not-eligible' }> {
    const { telegramUserId } = job.data;
    const marketplaces = await this.scheduler.eligibleMarketplaces(telegramUserId);
    if (!marketplaces.length) {
      void this.scheduler.refresh();
      return { skipped: 'not-eligible' };
    }
    // Сбой площадки бросается после прохода всех (`AccountingOrdersSyncError`).
    const report = await this.orders.syncUser(telegramUserId, { marketplaces });
    const parts = Object.entries(report.results).map(([marketplace, result]) =>
      'seen' in result
        ? `${marketplace} ${result.outcome}: заказов ${result.orders}, строк ${result.seen}, ` +
          `новых ${result.created}, изменено ${result.changed}`
        : `${marketplace} ${result.outcome}`,
    );
    this.logger.log(`Строки заказов ${telegramUserId}: ${parts.join('; ')}`);
    return report;
  }

  @OnQueueFailed()
  onFailed(job: Job<IAccountingOrdersJob>, error: Error): void {
    void this.errors.report({
      error,
      source: 'queue',
      context: 'accounting-orders',
      telegramUserId: job?.data?.telegramUserId,
      action: 'sync-accounting-orders',
    });
  }
}
