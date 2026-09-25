import type { TMarketReportKey } from '../../yandex/market-reports/market-reports.domain';
import type { IMarketReportParams } from '../../yandex/market-reports/market-reports.service';
import type { TPaymentsPeriod } from '../../yandex/payments/payments.domain';
import type { ICrmOption } from '../jobs/crm-period.domain';

import {
  KEY_DETALIZATIONS,
  MARKET_REPORT_KEYS,
  MARKET_REPORT_META,
  SHOWS_GROUPINGS,
  mktNoDataText,
  realizationMonths,
} from '../../yandex/market-reports/market-reports.domain';
import { moscowDay } from '../../yandex/reports/moscow-day';
import { isFby } from '../../yandex/stocks/placement';
import { CrmJobError, withoutIcon } from '../jobs/crm-jobs.domain';
import { parsePaymentsPeriod, paymentsPeriodOptions } from '../jobs/crm-period.domain';

/**
 * «Отчёты Маркета» в CRM — чистая часть: разбор params, вид ответа и опции
 * форм. Все шесть отчётов — xlsx Маркета как есть; тела запросов и даты
 * строит `MarketReportsService` (общий с ботом).
 *
 * Проверка params — строгая и здесь, а не в сервисе: сервис молча подставляет
 * умолчания (месяц 0, группировка CATEGORIES), и в боте это безопасно — кнопки
 * другого не пришлют. HTTP пришлёт что угодно.
 */

export function marketReportJobKind(key: TMarketReportKey): string {
  return `market-reports:${key}`;
}

const BAD_PARAMS = 'Не удалось разобрать параметры отчёта. Выберите их заново.';

/** Параметры в том виде, в каком они едут в сервис и обратно эхом. */
export type TCrmMarketParams = Pick<
  IMarketReportParams,
  'year' | 'month' | 'categoryId' | 'periodKey' | 'grouping' | 'detalizationLevel'
>;

export function parseMarketParams(
  key: TMarketReportKey,
  params: Record<string, unknown>,
  now: Date,
): TCrmMarketParams {
  switch (key) {
    case 'real':
      return parseRealizationMonth(params, now);
    case 'turn':
      return {};
    case 'comp': {
      const categoryId = params?.categoryId;
      if (typeof categoryId !== 'number' || !Number.isSafeInteger(categoryId) || categoryId <= 0) {
        throw new CrmJobError('Выберите категорию.');
      }
      return { categoryId, periodKey: parsePaymentsPeriod(params?.periodKey) };
    }
    case 'shows':
      return {
        periodKey: parsePaymentsPeriod(params?.periodKey),
        grouping: oneOf(params?.grouping, SHOWS_GROUPINGS),
      };
    case 'key':
      return { detalizationLevel: oneOf(params?.detalizationLevel, KEY_DETALIZATIONS) };
    case 'geo':
      return { periodKey: parsePaymentsPeriod(params?.periodKey) };
  }
}

/**
 * Месяц реализации — любой ЗАВЕРШЁННЫЙ, а не только из `realizationMonths`.
 * Форма, открытая 31-го, отправленная 1-го, иначе получила бы отказ за месяц,
 * который ей только что предложили. Текущий и будущий месяц — отказ: отчёт
 * помесячный бухгалтерский, незакрытый месяц в нём бессмыслен.
 */
function parseRealizationMonth(params: Record<string, unknown>, now: Date): TCrmMarketParams {
  const { year, month } = params ?? {};
  if (
    typeof year !== 'number' ||
    typeof month !== 'number' ||
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    year < 2000
  ) {
    throw new CrmJobError(BAD_PARAMS);
  }
  const today = moscowDay(now);
  if (year * 12 + month >= today.year * 12 + today.month) {
    throw new CrmJobError('Реализация собирается только за завершённый месяц.');
  }
  return { year, month };
}

function oneOf(value: unknown, table: readonly { code: string }[]): string {
  if (typeof value !== 'string' || !table.some((row) => row.code === value)) {
    throw new CrmJobError(BAD_PARAMS);
  }
  return value;
}

export interface ICrmMarketReportView {
  /** Эхо отчёта и параметров: дедуп по kind вернёт задачу со СТАРЫМИ params. */
  key: TMarketReportKey;
  params: TCrmMarketParams;
  /** Маркет собрал отчёт, но данных нет (DONE без файла) — не ошибка. */
  empty: boolean;
  emptyText: string | null;
  filename: string | null;
}

export function toCrmMarketReportView(
  key: TMarketReportKey,
  params: TCrmMarketParams,
  filename: string | null,
): ICrmMarketReportView {
  return {
    key,
    params,
    empty: filename === null,
    emptyText: filename === null ? withoutIcon(mktNoDataText(key)) : null,
    filename,
  };
}

// --- опции форм ---------------------------------------------------------------

export interface ICrmMarketReportOption {
  key: TMarketReportKey;
  title: string;
  /** Квота Маркета «N в час» — форма предупреждает до запуска. */
  hourlyLimit: number | null;
}

export interface ICrmMarketReportsOptions {
  /** Отчёты, доступные ОТКРЫТОМУ магазину: оборачиваемость — только FBY. */
  reports: ICrmMarketReportOption[];
  periods: ICrmOption<TPaymentsPeriod>[];
  months: { year: number; month: number; label: string }[];
  groupings: ICrmOption[];
  detalizations: ICrmOption[];
}

/** Отчёт открыт этому магазину? Неизвестная модель — не FBY (правило `isFby`). */
export function isMarketReportAvailable(
  key: TMarketReportKey,
  placementType: string | null | undefined,
): boolean {
  return !MARKET_REPORT_META[key].fbyOnly || isFby(placementType);
}

export function marketReportsOptions(
  placementType: string | null | undefined,
  now: Date,
): ICrmMarketReportsOptions {
  return {
    reports: MARKET_REPORT_KEYS.filter((key) => isMarketReportAvailable(key, placementType)).map(
      (key) => ({
        key,
        title: MARKET_REPORT_META[key].title,
        hourlyLimit: MARKET_REPORT_META[key].hourlyLimit ?? null,
      }),
    ),
    periods: paymentsPeriodOptions(),
    months: realizationMonths(now).map(({ year, month, label }) => ({ year, month, label })),
    groupings: SHOWS_GROUPINGS.map(({ code, label }) => ({ key: code, label })),
    detalizations: KEY_DETALIZATIONS.map(({ code, label }) => ({ key: code, label })),
  };
}
