import type { MarkupRow, PriceSetPlan, PriceSetTarget } from '../price-set.domain';

import { describe, expect, it } from 'vitest';

import {
  applyLines,
  defaultExcluded,
  deltaText,
  localFileError,
  mapApplyError,
  mapPlanError,
  markupExample,
  markupRowError,
  markupsOf,
  parseMarkupText,
  targetCount,
  targetStatus,
} from './mapPriceSet.price-set';

import { ApiError } from '@/shared/http';

const row = (patch: Partial<MarkupRow>): MarkupRow => ({
  marketplace: 'ym',
  label: 'Яндекс Маркет',
  on: true,
  text: '250',
  ...patch,
});

const target = (patch: Partial<PriceSetTarget> = {}): PriceSetTarget => ({
  marketplace: 'ym',
  marketplaceLabel: 'Яндекс Маркет',
  blockedBy: null,
  blockedText: null,
  error: null,
  updates: [
    {
      key: 'ym:a',
      sku: 'a',
      mpSku: 'a',
      name: null,
      from: 1000,
      to: 1100,
      deltaPct: 10,
      risky: false,
    },
    {
      key: 'ym:b',
      sku: 'b',
      mpSku: 'b',
      name: null,
      from: 1000,
      to: 2500,
      deltaPct: 150,
      risky: true,
    },
  ],
  unchanged: 0,
  skipped: [],
  willWrite: true,
  ...patch,
});

describe('наценка', () => {
  it('процент — число 1…10 000, запятая как точка', () => {
    expect(parseMarkupText(' 250 ')).toBe(250);
    expect(parseMarkupText('12,5')).toBe(12.5);
    expect(parseMarkupText('0')).toBeNull();
    expect(parseMarkupText('10001')).toBeNull();
    expect(parseMarkupText('-5')).toBeNull();
    expect(parseMarkupText('')).toBeNull();
  });

  it('пример под полем: 250% — 1000 ₽ → 2500 ₽', () => {
    expect(markupExample(250).replace(/\s/g, ' ')).toBe('1 000 ₽ → 2 500 ₽');
  });

  it('в запрос — только отмеченные строки с верным процентом', () => {
    expect(
      markupsOf([
        row({}),
        row({ marketplace: 'ozon', on: false, text: '300' }),
        row({ marketplace: 'wb', text: '120' }),
      ]),
    ).toEqual({ ym: 250, wb: 120 });
  });

  it('ошибка строки — только у отмеченной с плохим процентом', () => {
    expect(markupRowError(row({ text: 'abc' }))).toContain('от 1');
    expect(markupRowError(row({ on: false, text: 'abc' }))).toBeNull();
    expect(markupRowError(row({}))).toBeNull();
  });
});

describe('файл и ошибки сервера', () => {
  it('csv и Excel принимаются, остальное и > 10 МБ — нет', () => {
    expect(localFileError({ name: 'цены.CSV', size: 10 })).toBeNull();
    expect(localFileError({ name: 'цены.xls', size: 10 })).toBeNull();
    expect(localFileError({ name: 'цены.pdf', size: 10 })).toContain('цены.pdf');
    expect(localFileError({ name: 'цены.xlsx', size: 11 * 1024 * 1024 })).toContain('10 МБ');
  });

  it('INVALID_FILE — под полем, PLAN_RUNNING — общая ошибка с id идущего плана', () => {
    expect(mapPlanError(new ApiError('плохой файл', 400, 'INVALID_FILE')).file).toBe('плохой файл');
    const running = mapPlanError(
      new ApiError('План цен уже считается', 409, 'PLAN_RUNNING', null, { jobId: 'p1' }),
    );
    expect(running).toEqual({ file: null, form: 'План цен уже считается', runningJobId: 'p1' });
    expect(mapPlanError(new Error('x')).form).toContain('Не удалось');
  });

  it('PRICE_SET_RUNNING несёт id идущей записи, WRITE_CLOSED — только текст', () => {
    expect(
      mapApplyError(new ApiError('идёт', 409, 'PRICE_SET_RUNNING', null, { jobId: 'w1' })),
    ).toEqual({ message: 'идёт', runningJobId: 'w1' });
    expect(mapApplyError(new ApiError('закрыта', 403, 'WRITE_CLOSED')).runningJobId).toBeNull();
  });
});

describe('план', () => {
  it('Δ со знаком; без текущей цены — «нет цены»', () => {
    expect(deltaText(12.5)).toBe('+12,5%');
    expect(deltaText(-40)).toBe('−40%');
    expect(deltaText(null)).toBe('нет цены');
  });

  it('рискованные строки сняты по умолчанию', () => {
    const plan = { targets: [target()] } as PriceSetPlan;
    expect([...defaultExcluded(plan)]).toEqual(['ym:b']);
  });

  it('к записи — изменения площадки без снятых; закрытая площадка — ноль', () => {
    expect(targetCount(target(), new Set(['ym:b']))).toBe(1);
    expect(targetCount(target(), new Set())).toBe(2);
    expect(targetCount(target({ willWrite: false }), new Set())).toBe(0);
  });

  it('статус карточки — по решениям сервера', () => {
    expect(targetStatus(target(), 1).label).toBe('Запишем 1');
    expect(targetStatus(target(), 0).label).toBe('Всё снято');
    expect(targetStatus(target({ willWrite: false }), 0).label).toBe('Только просмотр');
    expect(targetStatus(target({ blockedBy: 'read-error' }), 0).variant).toBe('danger');
    expect(targetStatus(target({ updates: [] }), 0).label).toBe('Совпадает');
  });

  it('итог записи по площадкам и причины пропуска', () => {
    expect(
      applyLines({
        writes: [
          { marketplace: 'ym', requested: 3, written: 3, errors: [], skipped: [] },
          {
            marketplace: 'wb',
            requested: 2,
            written: 0,
            errors: [],
            skipped: [],
            skipReason: 'no-access',
          },
          {
            marketplace: 'ozon',
            requested: 2,
            written: 1,
            errors: [{ batch: 0, message: 'отказ' }],
            skipped: [],
          },
        ],
      }),
    ).toEqual([
      'Яндекс Маркет: записано 3 из 3.',
      'Wildberries: не записано — у токена нет права «Цены и скидки».',
      'Ozon: записано 1 из 2; отказ площадки: отказ.',
    ]);
    expect(applyLines({ writes: [] })[0]).toContain('нечего');
  });
});
