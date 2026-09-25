import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import { FEATURE, isFeatureEnabled } from '../../telegram/bots/shared/features.domain';
import { FbyService } from '../../yandex/fby/fby.service';
import { XLSX_TYPE } from '../jobs/crm-jobs.domain';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';

import { FBY_JOB_KIND, toCrmFbyView } from './crm-fby.domain';

/**
 * Kind «FBY»: тот же `FbyService.buildData`, что под экраном бота; файл — та же
 * книга. Модель магазина здесь не проверяется: `fby` — FBY-only фича, и 403
 * `FBY_ONLY` по ОТКРЫТОМУ магазину даёт `assertFeatures` при постановке.
 */
@Injectable()
export class CrmFbyKinds implements OnModuleInit {
  constructor(
    private readonly registry: CrmJobsRegistry,
    private readonly fby: FbyService,
  ) {}

  onModuleInit(): void {
    this.registry.register(FBY_JOB_KIND, {
      features: [FEATURE.FBY],
      run: (context) => this.run(context),
    });
  }

  async run(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    // Секция поставок — из снимка фич (у админа — все), как бот решает в fby.handler.
    const supply = isFeatureEnabled(context.features, FEATURE.FBY_SUPPLY);
    const report = await this.fby.buildData(context.store, now, { supply });
    const { workbook } = report;
    return {
      data: toCrmFbyView(report),
      file: workbook
        ? { buffer: workbook.buffer, filename: workbook.filename, contentType: XLSX_TYPE }
        : null,
    };
  }
}
