import type { TUploadDecision } from './stock-upload-policy';
import type { IStoreEntry } from '../../../database/schemas/yandex-market.schema';
import type { IYandexTenantCredentials } from '../yandex-api.client';

import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../config/app-config.service';

import { placementOfCampaign } from './placement';
import { StockSyncService } from './stock-sync.service';
import { decideUpload, needsPlacement } from './stock-upload-policy';

/** Та часть документа магазина, которая нужна решению. */
export interface IUploadStore {
  token?: string;
  campaign_id?: string;
  business_id?: string;
  stores?: IStoreEntry[];
}

export interface IUploadRequest {
  savePrices: boolean;
  stockFeatureOn: boolean;
  dryRun: boolean;
}

/** Креды магазина или `null`, если он подключён не до конца. */
export function uploadCredentials(store: IUploadStore | null): IYandexTenantCredentials | null {
  if (!store?.campaign_id || !store.business_id || !store.token) return null;
  return { token: store.token, campaignId: store.campaign_id, businessId: store.business_id };
}

/**
 * Ранний слой барьеров записи остатков — общий для бота и CRM.
 *
 * Решает чистый `decideUpload`; сервис только добывает факты: env и модель
 * магазина. Модель — сначала из КЭША `store.stores` (после смены магазина в
 * боте она заведомо известна, типовой случай без единого запроса), потом живым
 * `StockSyncService.placementFor`: правило и способ его выяснить остаются в
 * одном месте. При выключенной записи (env или фича) модель не спрашивается
 * вовсе — раз писать не будем, незачем ходить в Маркет.
 */
@Injectable()
export class StockUploadPolicyService {
  constructor(
    private readonly stocks: StockSyncService,
    private readonly config: AppConfigService,
  ) {}

  async decide(
    store: IUploadStore,
    credentials: IYandexTenantCredentials,
    request: IUploadRequest,
  ): Promise<TUploadDecision> {
    const writeEnabled = this.config.stockWriteEnabled;
    const placementType = needsPlacement(writeEnabled, request.stockFeatureOn)
      ? (placementOfCampaign(store.stores, credentials.campaignId) ??
        (await this.stocks.placementFor(credentials)))
      : undefined;

    return decideUpload({ ...request, writeEnabled, placementType });
  }
}
