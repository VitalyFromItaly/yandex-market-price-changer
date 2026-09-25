import type { TCrmOrderReport } from './crm-orders.domain';
import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import {
  FEATURE,
  REPORT_TO_FEATURE,
  isFeatureEnabled,
} from '../../telegram/bots/shared/features.domain';
import { OrderReportsService } from '../../yandex/reports/order-reports.service';
import { reportWorkbook } from '../../yandex/reports/report-workbook';
import { YandexDateRangeError } from '../../yandex/yandex-date-window';
import { CrmJobError, XLSX_TYPE } from '../jobs/crm-jobs.domain';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';

import {
  CRM_ORDER_REPORTS,
  ordersJobKind,
  parseOrdersParams,
  toCrmOrdersView,
} from './crm-orders.domain';

/**
 * Четыре отчёта о заказах как фоновые задачи CRM (`orders:<report>`).
 *
 * `run` зовёт тот же `OrderReportsService.build`, что кнопка бота, и ту же
 * `reportWorkbook`, что его export*, — числа и файл совпадают с ботом по
 * построению. Фичу отчёта проверяет `CrmJwtGuard.assertFeatures` при
 * постановке; deep_history — модификатор, он едет снимком в контексте.
 */
@Injectable()
export class CrmOrdersKinds implements OnModuleInit {
  constructor(
    private readonly registry: CrmJobsRegistry,
    private readonly reports: OrderReportsService,
  ) {}

  onModuleInit(): void {
    for (const key of CRM_ORDER_REPORTS) {
      this.registry.register(ordersJobKind(key), {
        features: [REPORT_TO_FEATURE[key]],
        run: (context) => this.run(key, context),
      });
    }
  }

  async run(
    key: TCrmOrderReport,
    context: ICrmJobContext,
    now: Date = new Date(),
  ): Promise<ICrmJobOutput> {
    const period = parseOrdersParams(key, context.params);
    // Один момент (`now`) на сборку, книгу и подписи: имя файла и «на … МСК»
    // обязаны называть одно и то же время.

    let result;
    try {
      result = await this.reports.build(context.store, key, now, period, {
        deepHistory: isFeatureEnabled(context.features, FEATURE.DEEP_HISTORY),
      });
    } catch (error) {
      // Период глубже 30 дней без deep_history (или начало позже конца) —
      // ожидаемый отказ с готовым текстом, а не сбой: админов не будим.
      if (error instanceof YandexDateRangeError) throw new CrmJobError(error.userMessage);
      throw error;
    }

    const workbook = reportWorkbook(result, now);
    return {
      data: toCrmOrdersView(result, workbook, now),
      file: workbook
        ? { buffer: workbook.buffer, filename: workbook.filename, contentType: XLSX_TYPE }
        : null,
    };
  }
}
