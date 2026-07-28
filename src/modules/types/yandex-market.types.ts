export interface IFileInfo {
  filename: string;
  originalName: string;
  filePath: string;
  fileSize: number;
  uploadedAt: Date;
}

export interface IParsingResult {
  success: boolean;
  data: any[]; // В идеале здесь должен быть TParsedPriceRow, но избегаем лишних зависимостей
  uniqueSkus: string[];
  totalItems: number;
  error?: string;
}

export interface IYandexApiResult {
  success: boolean;
  offers: any[];
  processedBatches: number;
  totalRequested: number;
  error?: string;
}

export interface IComparisonResult {
  matched: number;
  priceMatches: number;
  priceMismatches: number;
  onlyInParser: number;
  onlyInYandex: number;
  matchPercentage: number;
  toUpdate: any[]; // TParsedPriceRow
  toCreate: any[]; // TParsedPriceRow
  toZeroStock: any[];
}

export interface IProcessingResult {
  fileInfo: IFileInfo;
  parsing: IParsingResult;
  yandexApi?: IYandexApiResult;
  comparison?: IComparisonResult;
  yandexSettings?: any; // YandexMarketDocument
  hasApiSettings: boolean;
} 