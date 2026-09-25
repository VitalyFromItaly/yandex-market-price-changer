import type {
  PurchasePricesPage,
  PurchasePricesQuery,
  PurchasePricesResponse,
  UploadAccepted,
  UploadAcceptedResponse,
} from '../price-list.domain';

import { mapPurchasePrices, mapUploadAccepted } from '../mappers/mapPriceList.price-list';
import { PURCHASE_PRICES_PAGE_SIZE } from '../price-list.domain';

import { http } from '@/shared/http';

const BASE = '/ym/price-list';

export const priceListApi = {
  /**
   * multipart: файл, флаг «только проверка» и ключ магазина — остатки пишутся на
   * склад открытого магазина. Итог — фоновая задача по jobId.
   */
  upload: async (file: File, dryRun: boolean, store: string): Promise<UploadAccepted> => {
    const form = new FormData();
    form.append('dryRun', String(dryRun));
    form.append('store', store);
    form.append('file', file, file.name);
    return mapUploadAccepted(await http.upload<UploadAcceptedResponse>(`${BASE}/upload`, form));
  },

  purchasePrices: async (query: PurchasePricesQuery): Promise<PurchasePricesPage> => {
    const params = new URLSearchParams({
      page: String(query.page),
      limit: String(PURCHASE_PRICES_PAGE_SIZE),
    });
    if (query.q.length > 0) params.set('q', query.q);
    return mapPurchasePrices(
      await http.get<PurchasePricesResponse>(`${BASE}/purchase-prices?${params.toString()}`),
    );
  },
};
