import type { YandexMarketDocument } from '../../../database/schemas/yandex-market.schema';
import type { TFbyStockError } from '../fby/fby-message';

import { Injectable } from '@nestjs/common';

import { ErrorReporter } from '../../errors/error-reporter.service';
import { FbyStockService } from '../fby/fby-stock.service';
import { YandexClientFactory } from '../yandex-client.factory';

import { isFby, placementOfCampaign } from './placement';
import { fbyStockLevels, storeStockLevels } from './stock-levels';
import { StockSyncService } from './stock-sync.service';

/** Остатки магазина по артикулам либо причина, почему их нет. */
export interface IStockLevels {
  placement: string | null;
  /** Момент съёмки (на FBY — отчёта, который мог прийти из мемо). */
  takenAt: Date | null;
  stocks: Record<string, number> | null;
  error?: TFbyStockError;
}

/**
 * Остатки по артикулам для главной CRM. Только ЧТЕНИЕ: запись остатков живёт в
 * `StockSyncService` и сюда не заходит.
 *
 * FBY — через `FbyStockService.safeLoad`: его мемо и single-flight держат лимит
 * генерации отчёта, и разделы «FBY»/«Склады» делят с главной один снимок.
 */
@Injectable()
export class StockLevelsService {
  constructor(
    private readonly clients: YandexClientFactory,
    private readonly fbyStock: FbyStockService,
    private readonly stockSync: StockSyncService,
    private readonly errors: ErrorReporter,
  ) {}

  public async levels(store: YandexMarketDocument, now = new Date()): Promise<IStockLevels> {
    const credentials = {
      token: store.token,
      campaignId: store.campaign_id,
      businessId: store.business_id,
    };
    const placement =
      placementOfCampaign(store.stores, store.campaign_id) ??
      (await this.stockSync.placementFor(credentials));

    if (isFby(placement)) {
      const { snapshot, error } = await this.fbyStock.safeLoad(store);
      return snapshot
        ? {
            placement,
            takenAt: snapshot.takenAt,
            stocks: fbyStockLevels(snapshot.summary.rows),
          }
        : { placement, takenAt: null, stocks: null, error: error ?? 'generic' };
    }

    try {
      const client = this.clients.forTenant(credentials);
      const [offers, own] = await Promise.all([client.loadStocks(), client.listStoreWarehouses()]);
      return {
        placement: placement ?? null,
        takenAt: now,
        stocks: storeStockLevels(offers, new Set(own.map((warehouse) => warehouse.id))),
      };
    } catch (error) {
      void this.errors.report({
        error,
        source: 'yandex',
        context: 'crm:stocks',
        telegramUserId: store.telegramUserId,
        action: 'остатки по товарам',
      });
      return { placement: placement ?? null, takenAt: null, stocks: null, error: 'generic' };
    }
  }
}
