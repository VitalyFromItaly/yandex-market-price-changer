import type {
  SyncMarketplaceResponse,
  SyncMarketplaceRow,
  SyncPeriodResponse,
  SyncPeriodRow,
  SyncResponse,
  SyncTone,
  SyncView,
} from '../accounting.domain';

import { formatSavedAt } from '@/shared/utils';

const MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

/** «2026-10» → «Октябрь 2026». */
export function monthLabel(month: string): string {
  const [year, index] = month.split('-').map(Number);
  const name = index ? MONTHS[index - 1] : undefined;
  return name ? `${name} ${year}` : month;
}

function toneOf(period: SyncPeriodResponse): SyncTone {
  if (period.outcome === 'failed') return 'failed';
  if (period.missed) return period.outcome ? 'missed' : 'idle';
  return 'ok';
}

const STATUS_BY_TONE: Record<SyncTone, string> = {
  ok: 'Загружено',
  failed: 'Сбой',
  missed: 'Пропущен',
  idle: 'Ещё не загружался',
};

function attemptLabel(period: SyncPeriodResponse, now: Date): string | null {
  if (!period.lastAttemptAt) return null;
  const at = formatSavedAt(period.lastAttemptAt, now) ?? period.lastAttemptAt;
  const how = period.triggerLabel ? ` · ${period.triggerLabel.toLowerCase()}` : '';
  const nth = period.attempt && period.attempt > 1 ? `, попытка ${period.attempt}` : '';
  return `Попытка ${at}${how}${nth}`;
}

export function mapSyncPeriod(period: SyncPeriodResponse, now: Date = new Date()): SyncPeriodRow {
  const tone = toneOf(period);
  const success = period.lastSuccessAt ? formatSavedAt(period.lastSuccessAt, now) : null;
  return {
    key: period.month,
    monthLabel: monthLabel(period.month),
    tone,
    statusLabel: tone === 'ok' && period.outcomeLabel ? period.outcomeLabel : STATUS_BY_TONE[tone],
    attemptLabel: attemptLabel(period, now),
    successLabel: success ? `данные на ${success}` : 'успешной загрузки не было',
    error: period.error,
  };
}

export function mapSyncMarketplace(
  row: SyncMarketplaceResponse,
  now: Date = new Date(),
): SyncMarketplaceRow {
  const success = row.lastSuccessAt ? formatSavedAt(row.lastSuccessAt, now) : null;
  const periods = row.periods.map((period) => mapSyncPeriod(period, now));
  return {
    marketplace: row.marketplace,
    label: row.label,
    asOfLabel: success ? `данные на ${success}` : 'успешной загрузки не было',
    periods,
    missedCount: row.periods.filter((period) => period.missed).length,
  };
}

/** Журнал синхронизации → вид экрана. */
export function mapSync(response: SyncResponse, now: Date = new Date()): SyncView {
  const asOf = response.asOf ? formatSavedAt(response.asOf, now) : null;
  return {
    asOfLabel: asOf ? `Данные на ${asOf}` : null,
    scheduleLabel:
      `ЯМ и Ozon — текущий месяц каждые ${response.everyHours} ч, ночью — ` +
      `${response.reloadMonths} мес. целиком; WB — ночью`,
    marketplaces: response.marketplaces.map((row) => mapSyncMarketplace(row, now)),
  };
}
