import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { RecommendationsService } from '../../yandex/recommendations/recommendations.service';
import { XLSX_TYPE } from '../jobs/crm-jobs.domain';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';

import { RECOMMENDATIONS_JOB_KIND, toCrmRecommendationsView } from './crm-recommendations.domain';

/**
 * Kind «Рекомендации цен». Зовёт тот же `RecommendationsService.build`, что
 * процессор бота; файл — та же книга.
 *
 * 420 не оборачивается в CrmJobError: квота метода поминутная (100/мин), и
 * общий текст процессора CRM «будет чуть позже» здесь правдив — в отличие от
 * часовых квот «Отчётов Маркета».
 */
@Injectable()
export class CrmRecommendationsKinds implements OnModuleInit {
  constructor(
    private readonly registry: CrmJobsRegistry,
    private readonly recommendations: RecommendationsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(RECOMMENDATIONS_JOB_KIND, {
      features: [FEATURE.PRICE_RECOMMENDATIONS],
      run: (context) => this.run(context),
    });
  }

  async run(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    const report = await this.recommendations.build(context.store, now);
    const { workbook } = report;
    return {
      data: toCrmRecommendationsView(report),
      file: workbook
        ? { buffer: workbook.buffer, filename: workbook.filename, contentType: XLSX_TYPE }
        : null,
    };
  }
}
