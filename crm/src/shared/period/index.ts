// Период отчёта — общий для разделов с выбором периода.
export {
  DEFAULT_PERIOD,
  HISTORY_WINDOW_DAYS,
  PERIOD,
  PERIOD_LABEL,
  dayToIso,
  isoToDay,
  minDayIso,
  moscowTodayIso,
  periodFromQuery,
  periodParams,
  periodQuery,
  samePeriod,
} from './period';
export type { PeriodKey, ReportPeriod } from './period';
export { default as PeriodPicker } from './PeriodPicker.vue';
export { useLinkedPeriod } from './useLinkedPeriod';
