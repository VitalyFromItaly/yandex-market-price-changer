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
export { default as RangePicker } from './RangePicker.vue';
export { useLinkedPeriod } from './useLinkedPeriod';
export {
  MAX_RANGE_DAYS,
  RANGE_PRESET,
  RANGE_PRESET_OPTIONS,
  isValidRange,
  previousRange,
  rangeDays,
  rangeFromQuery,
  rangeLabel,
  rangeOf,
  rangeQuery,
  sameRange,
  shiftDay,
} from './range';
export type { RangePreset } from './range';
export { useLinkedRange } from './useLinkedRange';
export { monthLabel, recentMonths } from './month';
