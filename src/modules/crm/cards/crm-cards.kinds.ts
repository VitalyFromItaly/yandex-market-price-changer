import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { CardsService } from '../../yandex/cards/cards.service';
import { XLSX_TYPE } from '../jobs/crm-jobs.domain';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';

import { CARDS_JOB_KIND, toCrmCardsView } from './crm-cards.domain';

/** Kind «Карточки»: тот же `CardsService.build`, что у процессора бота; файл — та же книга. */
@Injectable()
export class CrmCardsKinds implements OnModuleInit {
  constructor(
    private readonly registry: CrmJobsRegistry,
    private readonly cards: CardsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(CARDS_JOB_KIND, {
      features: [FEATURE.OFFER_CARDS],
      run: (context) => this.run(context),
    });
  }

  async run(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    const report = await this.cards.build(context.store, now);
    const { workbook } = report;
    return {
      data: toCrmCardsView(report),
      file: workbook
        ? { buffer: workbook.buffer, filename: workbook.filename, contentType: XLSX_TYPE }
        : null,
    };
  }
}
