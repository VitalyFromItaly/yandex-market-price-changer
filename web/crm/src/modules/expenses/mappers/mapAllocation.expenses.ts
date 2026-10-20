import type {
  AllocationModel,
  AllocationPreset,
  AllocationRange,
  ExpenseAllocation,
} from '../expenses.domain';

import { formatDay, kopecksToRubText } from './mapExpenses.expenses';

import { DAY_RANGE_PRESETS, moscowToday, presetRange as dayRange } from '@/shared/utils';

/** Пресеты, сегодня и границы — общие с «Закупками» (shared/utils/days.ts). */
export const ALLOCATION_PRESETS: readonly { value: AllocationPreset; label: string }[] =
  DAY_RANGE_PRESETS;
export { moscowToday };

export function presetRange(preset: AllocationPreset, today: string): AllocationRange {
  return dayRange(preset, today);
}

export function toAllocationModel(allocation: ExpenseAllocation): AllocationModel {
  return {
    rangeLabel: `${formatDay(allocation.from)} — ${formatDay(allocation.to)}`,
    total: kopecksToRubText(allocation.totalKopecks),
    isEmpty: allocation.totalKopecks === 0,
    byCategory: allocation.byCategory.map(({ key, label, kopecks }) => ({
      key,
      label,
      amount: kopecksToRubText(kopecks),
    })),
  };
}
