import type {
  MarketCategories,
  MarketCategoriesResponse,
  MarketReport,
  MarketReportForm,
  MarketReportKey,
  MarketReportParams,
  MarketReportResponse,
  MarketReportsOptions,
  MarketReportsOptionsResponse,
  Option,
} from '../market-reports.domain';

const option = ({ key, label }: { key: string; label: string }): Option => ({ value: key, label });

function monthValue(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function mapMarketReportsOptions(
  response: MarketReportsOptionsResponse,
): MarketReportsOptions {
  return {
    reports: response.reports.map(({ key, title, hourlyLimit }) => ({
      key,
      label: title,
      hourlyLimit,
    })),
    periods: response.periods.map(option),
    months: response.months.map(({ year, month, label }) => ({
      value: monthValue(year, month),
      label,
    })),
    groupings: response.groupings.map(option),
    detalizations: response.detalizations.map(option),
  };
}

export function mapMarketCategories(response: MarketCategoriesResponse): MarketCategories {
  return {
    options: response.categories.map(({ categoryId, name }) => ({
      value: categoryId,
      label: name,
    })),
    emptyText: response.categories.length ? null : (response.emptyText ?? 'Категорий нет.'),
  };
}

/** Значения формы по умолчанию — первые варианты сервера; категорию продавец выбирает сам. */
export function defaultForm(options: MarketReportsOptions): MarketReportForm {
  return {
    period: options.periods[0]?.value ?? null,
    month: options.months[0]?.value ?? null,
    categoryId: null,
    grouping: options.groupings[0]?.value ?? null,
    detalization: options.detalizations[0]?.value ?? null,
  };
}

/**
 * params задачи отчёта — в точности форма, которую сервер вернёт эхом; null —
 * форма заполнена не до конца (кнопка «Сформировать» неактивна).
 */
export function marketParams(
  key: MarketReportKey,
  form: MarketReportForm,
): MarketReportParams | null {
  switch (key) {
    case 'real': {
      const [year, month] = (form.month ?? '').split('-').map(Number);
      return year && month ? { year, month } : null;
    }
    case 'turn':
      return {};
    case 'comp':
      return form.categoryId !== null && form.period !== null
        ? { categoryId: form.categoryId, periodKey: form.period }
        : null;
    case 'shows':
      return form.period !== null && form.grouping !== null
        ? { periodKey: form.period, grouping: form.grouping }
        : null;
    case 'key':
      return form.detalization !== null ? { detalizationLevel: form.detalization } : null;
    case 'geo':
      return form.period !== null ? { periodKey: form.period } : null;
  }
}

/** Эхо сервера совпадает с запросом — порядок ключей не важен. */
export function sameParams(a: MarketReportParams, b: MarketReportParams): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

export function mapMarketReport(response: MarketReportResponse): MarketReport {
  return {
    key: response.key,
    emptyText: response.empty ? (response.emptyText ?? 'Данных за период нет.') : null,
    filename: response.filename,
  };
}

/** Что собрано — подписями из вариантов формы («Прошлый месяц · По товарам»). */
export function paramsCaption(
  params: MarketReportParams,
  options: MarketReportsOptions,
  categories: MarketCategories | null,
): string | null {
  const labelOf = (list: Option<string | number>[], value: unknown) =>
    list.find((item) => item.value === value)?.label;
  const parts = [
    typeof params.year === 'number' && typeof params.month === 'number'
      ? labelOf(options.months, monthValue(params.year, params.month))
      : undefined,
    categories ? labelOf(categories.options, params.categoryId) : undefined,
    labelOf(options.periods, params.periodKey),
    labelOf(options.groupings, params.grouping),
    labelOf(options.detalizations, params.detalizationLevel),
  ].filter((part): part is string => typeof part === 'string');
  return parts.length ? parts.join(' · ') : null;
}
