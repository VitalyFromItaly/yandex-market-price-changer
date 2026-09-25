import type { ClassValue } from 'clsx';

import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Склейка классов с разрешением конфликтов Tailwind: `cn('px-2', props.class)`. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
