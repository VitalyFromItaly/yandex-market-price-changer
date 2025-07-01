export type TCampaign = {
  domain: string;
  id: number;
  clientId: number;
  business: TCampaignBusiness;
  placementType: string;
};

export type TCampaignBusiness = {
  id: number;
  name: string;
}

export type TPaging = {
  nextPageToken: string;
};

export type TBasicPrice = {
  value: number,
  currencyId: string,
  updatedAt: string // '2025-05-02T11:12:24+03:00'
}

export type TWarning = {
  message: string;
  comment: string;
}

export type TOffer  = {
  offerId: string,
  basicPrice: TBasicPrice;
  status: TOfferStatus,
  warnings: TWarning[]
};

export type TUpdateOfferPrice = {
  value: number;
  discountBase?: number;
  currencyId: 'RUR';
  vat?: TVatValue;
};

export type TUpdateOffer = {
  offerId: string;
  price: TUpdateOfferPrice;
};

export type TUpdateStockItem = {
  count: number;
  updatedAt?: string;
};

export type TUpdateStock = {
  sku: string;
  items: TUpdateStockItem[];
};

export type TUpdateStocksRequest = {
  skus: TUpdateStock[];
};

export const VAT_DICTIONARY = {
  2: 2, // НДС 10%. Например, используется при реализации отдельных продовольственных и медицинских товаров.
  5: 5, // НДС 0%. Например, используется при продаже товаров, вывезенных в таможенной процедуре экспорта, или при оказании услуг по международной перевозке товаров.
  6: 6, // НДС не облагается, используется только для отдельных видов услуг.
  7: 7, // НДС 20%. Основной НДС с 2019 года.
  10: 10, // НДС 5%. НДС для упрощенной системы налогообложения (УСН).
  11: 11 // НДС 7%. НДС для упрощенной системы налогообложения (УСН).
} as const;

export type TVatValue = keyof typeof VAT_DICTIONARY;

export const OFFER_STATUSES = {
  PUBLISHED: 'PUBLISHED', // Готов к продаже.
  CHECKING: 'CHECKING', // На проверке.
  DISABLED_BY_PARTNER: 'DISABLED_BY_PARTNER', // Скрыт вами.
  REJECTED_BY_MARKET: 'REJECTED_BY_MARKET', // Отклонен.
  DISABLED_AUTOMATICALLY: 'DISABLED_AUTOMATICALLY', // Исправьте ошибки.
  CREATING_CARD: 'CREATING_CARD', // Создается карточка.
  NO_CARD: 'NO_CARD', // Нужна карточка.
  NO_STOCKS: 'NO_STOCKS', // Нет на складе.
  ARCHIVED: 'ARCHIVED', // В архиве.
} as const;

export type TOfferStatus = keyof typeof OFFER_STATUSES;
