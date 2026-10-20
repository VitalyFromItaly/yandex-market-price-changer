/**
 * «Отчёты Маркета» — шесть отчётов, которые собирает сам Маркет, xlsx как есть.
 * Зеркало ответов `GET /ym/market-reports/{options,categories}` и фоновых
 * задач `market-reports:<key>` (src/modules/crm/market-reports/). Варианты форм
 * и список отчётов (оборачиваемость — только FBY) приходят с сервера; даты
 * периода считает сервер в момент сборки — фронт шлёт ключ пресета.
 */

export const MARKET_REPORTS_ROUTE_NAME = 'ym-market-reports';

export type MarketReportKey = 'real' | 'turn' | 'comp' | 'shows' | 'key' | 'geo';

export function marketReportJobKind(key: MarketReportKey): string {
  return `market-reports:${key}`;
}

export interface Option<T extends string | number = string> {
  value: T;
  label: string;
}

export interface MarketReportsOptionsResponse {
  reports: { key: MarketReportKey; title: string; hourlyLimit: number | null }[];
  periods: { key: string; label: string }[];
  months: { year: number; month: number; label: string }[];
  groupings: { key: string; label: string }[];
  detalizations: { key: string; label: string }[];
}

export interface MarketReportTab {
  key: MarketReportKey;
  label: string;
  /** Квота Маркета «N в час» — форма предупреждает до запуска. */
  hourlyLimit: number | null;
}

export interface MarketReportsOptions {
  reports: MarketReportTab[];
  periods: Option[];
  /** Значение — «ГГГГ-ММ». */
  months: Option[];
  groupings: Option[];
  detalizations: Option[];
}

export interface MarketCategoriesResponse {
  categories: { categoryId: number; name: string; offers: number }[];
  emptyText: string | null;
}

export interface MarketCategories {
  options: Option<number>[];
  emptyText: string | null;
}

/** Значения формы. Период общий для трёх отчётов, где он есть. */
export interface MarketReportForm {
  period: string | null;
  month: string | null;
  categoryId: number | null;
  grouping: string | null;
  detalization: string | null;
}

/** params задачи — ровно в той форме, в какой сервер вернёт их эхом. */
export type MarketReportParams = Record<string, string | number>;

export interface MarketReportResponse {
  key: MarketReportKey;
  params: MarketReportParams;
  empty: boolean;
  emptyText: string | null;
  filename: string | null;
}

export interface MarketReport {
  key: MarketReportKey;
  emptyText: string | null;
  filename: string | null;
}
