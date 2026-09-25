import type { TMarketReportKey } from '../../yandex/market-reports/market-reports.domain';
import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import { FEATURE } from '../../telegram/bots/shared/features.domain';
import {
  MARKET_REPORT_KEYS,
  MARKET_REPORT_META,
  mktRateLimitText,
  mktTurnoverFbyOnlyText,
} from '../../yandex/market-reports/market-reports.domain';
import { MarketReportsService } from '../../yandex/market-reports/market-reports.service';
import { placementOfCampaign } from '../../yandex/stocks/placement';
import { StockSyncService } from '../../yandex/stocks/stock-sync.service';
import { YandexRateLimitError } from '../../yandex/yandex-api.errors';
import { CrmJobError, XLSX_TYPE, withoutIcon } from '../jobs/crm-jobs.domain';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';

import {
  isMarketReportAvailable,
  marketReportJobKind,
  parseMarketParams,
  toCrmMarketReportView,
} from './crm-market-reports.domain';

/**
 * Шесть «Отчётов Маркета» как фоновые задачи CRM (`market-reports:<key>`).
 *
 * `run` зовёт тот же `MarketReportsService.build`, что процессор бота; даты
 * сервис считает сам в момент выполнения, в params едет только ключ периода.
 * Один флаг `market_reports` на все шесть — как в боте.
 */
@Injectable()
export class CrmMarketReportsKinds implements OnModuleInit {
  constructor(
    private readonly registry: CrmJobsRegistry,
    private readonly reports: MarketReportsService,
    private readonly stockSync: StockSyncService,
  ) {}

  onModuleInit(): void {
    for (const key of MARKET_REPORT_KEYS) {
      this.registry.register(marketReportJobKind(key), {
        features: [FEATURE.MARKET_REPORTS],
        run: (context) => this.run(key, context),
      });
    }
  }

  async run(
    key: TMarketReportKey,
    context: ICrmJobContext,
    now: Date = new Date(),
  ): Promise<ICrmJobOutput> {
    const params = parseMarketParams(key, context.params, now);
    const { store } = context;

    // Оборачиваемость — только FBY. Фича `market_reports` не FBY-only, поэтому
    // гвард модель не смотрит: проверка здесь, по ОТКРЫТОМУ магазину. Кэш →
    // живой listStores, как у бота (не отказывать несправедливо).
    if (MARKET_REPORT_META[key].fbyOnly) {
      const placement =
        placementOfCampaign(store.stores, store.campaign_id) ??
        (await this.stockSync.placementFor({
          token: store.token,
          campaignId: store.campaign_id,
          businessId: store.business_id,
        }));
      if (!isMarketReportAvailable(key, placement)) {
        throw new CrmJobError(withoutIcon(mktTurnoverFbyOnlyText()));
      }
    }

    let result;
    try {
      result = await this.reports.build(store, key, params, now);
    } catch (error) {
      // Квота 10/час у comp и shows — честный ответ продавцу, а не «лимит,
      // будет чуть позже» из общего userMessage: позже в пределах часа не будет.
      if (error instanceof YandexRateLimitError && MARKET_REPORT_META[key].hourlyLimit) {
        throw new CrmJobError(withoutIcon(mktRateLimitText(key)));
      }
      throw error;
    }

    const { file } = result;
    return {
      data: toCrmMarketReportView(key, params, file?.filename ?? null),
      file: file ? { buffer: file.buffer, filename: file.filename, contentType: XLSX_TYPE } : null,
    };
  }
}
