import { describe, expect, it } from 'vitest';

import { isoDayToRu } from './reportFile';

describe('isoDayToRu', () => {
  it('YYYY-MM-DD → ДД-ММ-ГГГГ, как в боте', () => {
    expect(isoDayToRu('2026-07-31')).toBe('31-07-2026');
  });

  it('не дата — как есть, а не «undefined-…»', () => {
    expect(isoDayToRu('вчера')).toBe('вчера');
  });
});
