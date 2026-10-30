import type { TMarketplace } from '../../../shared/marketplace';
import type { IPriceFileBadRow } from '../../price-set/price-set-file';
import type { IPriceSetRequest } from '../../price-set/price-set.domain';
import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import { CrmJobResultService } from '../../../database/services/crm-job-result.service';
import { MARKETPLACES } from '../../../shared/marketplace';
import { PriceFileError, parsePriceFile } from '../../price-set/price-set-file';
import {
  PRICE_SET_WRITE_FEATURE,
  PriceSetMarkupClosedError,
  PriceSetService,
} from '../../price-set/price-set.service';
import { FEATURE, isFeatureEnabled } from '../../telegram/bots/shared/features.domain';
import { CrmJobError } from '../jobs/crm-jobs.domain';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';

import {
  INVALID_MARKETPLACES_TEXT,
  INVALID_MARKUP_TEXT,
  PRICE_SET_KIND,
  parseMarketplaces,
  parseMarkups,
  toCrmPriceSet,
} from './crm-price-set.domain';

const NO_INPUT_TEXT = 'Файл не найден — загрузите его ещё раз.';

/**
 * План «Установки цен» (TASK-202) — kind уровня аккаунта под `price_set`.
 * Только чтение: товары, текущие цены площадок. Два входа — `params.markups`
 * (наценка, обычный `POST crm/jobs`) и файл (`POST crm/ym/price-set/upload`
 * кладёт его во вход задачи, `params.source: 'file'`). Запись — отдельным
 * маршрутом `apply` через очередь file-processing.
 */
@Injectable()
export class CrmPriceSetKinds implements OnModuleInit {
  constructor(
    private readonly registry: CrmJobsRegistry,
    private readonly priceSet: PriceSetService,
    private readonly results: CrmJobResultService,
  ) {}

  onModuleInit(): void {
    this.registry.register(PRICE_SET_KIND, {
      features: [FEATURE.PRICE_SET],
      scope: 'account',
      run: (context) => this.plan(context),
    });
  }

  async plan(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    const features = context.features ?? {};
    const { request, fileBad } = await this.requestOf(context);
    let result: Awaited<ReturnType<PriceSetService['plan']>>;
    try {
      result = await this.priceSet.plan(context.telegramUserId, features, request);
    } catch (error) {
      // Ожидаемый отказ — текстом продавцу, админов не будим.
      if (error instanceof PriceSetMarkupClosedError) throw new CrmJobError(error.userMessage);
      throw error;
    }
    return {
      data: toCrmPriceSet(result, {
        now,
        fileBad,
        writeOpen: Object.fromEntries(
          MARKETPLACES.map((marketplace) => [
            marketplace,
            isFeatureEnabled(features, PRICE_SET_WRITE_FEATURE[marketplace]),
          ]),
        ) as Record<TMarketplace, boolean>,
      }),
    };
  }

  private async requestOf(
    context: ICrmJobContext,
  ): Promise<{ request: IPriceSetRequest; fileBad: IPriceFileBadRow[] }> {
    if (context.params.source !== 'file') {
      const request = parseMarkups(context.params.markups);
      if (!request) throw new CrmJobError(INVALID_MARKUP_TEXT);
      return { request, fileBad: [] };
    }
    const marketplaces = parseMarketplaces(context.params.marketplaces);
    if (!marketplaces) throw new CrmJobError(INVALID_MARKETPLACES_TEXT);
    const input = await this.results.readInput(context.jobId);
    if (!input) throw new CrmJobError(NO_INPUT_TEXT);
    try {
      const file = parsePriceFile(input.buffer, input.filename);
      return {
        request: {
          desired: { source: 'file', rows: file.rows.map(({ sku, price }) => ({ sku, price })) },
          marketplaces,
        },
        fileBad: file.bad,
      };
    } catch (error) {
      if (error instanceof PriceFileError) throw new CrmJobError(error.message);
      throw error;
    }
  }
}
