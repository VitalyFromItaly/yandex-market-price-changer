export type TParsedPriceRow = {
  name: string;
  sku: string;
  price: number;
  count: number;
};

export type TParsedPriceList = {
  [groupName: string]: TParsedPriceRow[];
};
