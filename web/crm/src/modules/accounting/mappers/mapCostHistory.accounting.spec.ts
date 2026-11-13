import { describe, expect, it } from 'vitest';

import { costChange, costRecord } from './costHistory.fixtures.accounting';
import {
  correctionBody,
  formatMoment,
  fromMoscowInput,
  mapCostCorrectionError,
  toCorrectionForm,
  toCostChangeRows,
  toCostRecordRows,
  toMoscowInput,
} from './mapCostHistory.accounting';

import { ApiError } from '@/shared/http';

describe('момент по Москве', () => {
  it('ISO ↔ datetime-local: +3 часа, туда и обратно', () => {
    expect(toMoscowInput('2026-10-01T21:30:00.000Z')).toBe('2026-10-02T00:30');
    expect(fromMoscowInput('2026-10-02T00:30')).toBe('2026-10-01T21:30:00.000Z');
    expect(toMoscowInput('мусор')).toBe('');
    // Кривое поле уходит как есть — ошибку под поле ставит сервер.
    expect(fromMoscowInput('')).toBe('');
    expect(fromMoscowInput('2026-13-40T99:99')).toBe('2026-13-40T99:99');
  });

  it('подпись — дата всегда, даже сегодняшняя', () => {
    expect(formatMoment('2026-10-01T09:15:42.123Z')).toBe('01-10-2026 12:15');
    expect(formatMoment('мусор')).toBe('—');
  });
});

describe('строки истории закупа', () => {
  it('записи — новые сверху, закуп словами, автор «вы» для своей правки', () => {
    const rows = toCostRecordRows(
      [
        costRecord(),
        costRecord({
          id: 'r2',
          validFrom: '2026-10-05T10:00:00.000Z',
          purchase: { price: 12.5, currency: 'USD', rate: 90, extraCosts: 40 },
          source: 'manual',
          sourceLabel: 'Исправлено вручную',
          author: '222',
        }),
      ],
      '222',
    );
    expect(rows.map((row) => row.id)).toEqual(['r2', 'r1']);
    expect(rows[0]).toMatchObject({
      momentLabel: '05-10-2026 13:00',
      sourceLabel: 'Исправлено вручную',
      authorLabel: 'вы',
    });
    expect(rows[0]?.purchaseLabel).toContain('12,5 $ × 90 ₽');
    expect(rows[1]?.authorLabel).toBe('—');
  });

  it('журнал: было/стало, админ за продавца подписан; новой записи «было» нет', () => {
    const rows = toCostChangeRows(
      [
        costChange(),
        costChange({
          id: 'c2',
          action: 'insert',
          actionLabel: 'Добавлена цена',
          before: null,
          impersonatedBy: '1',
          createdAt: '2026-11-11T12:00:00.000Z',
        }),
      ],
      undefined,
    );
    expect(rows.map((row) => row.id)).toEqual(['c2', 'c1']);
    expect(rows[0]).toMatchObject({
      beforeLabel: null,
      authorLabel: '222 · администратор за продавца',
    });
    expect(rows[1]?.beforeLabel).toMatch(/^с 01-10-2026 12:15 · 1\s000\s₽$/);
    expect(rows[1]?.reason).toBe('Счёт поставщика');
  });
});

describe('форма исправления', () => {
  it('из записи: точный момент уходит, пока поле не трогали; курс у рублей не шлётся', () => {
    const form = toCorrectionForm(costRecord(), new Date('2026-11-11T10:00:00Z'));
    expect(form.validFrom).toBe('2026-10-01T12:15');
    expect(form.price).toBe('1000');
    expect(correctionBody({ ...form, rate: '90', reason: '  Счёт  ' })).toEqual({
      validFrom: '2026-10-01T09:15:42.123Z',
      price: '1000',
      currency: 'RUR',
      rate: null,
      extraCosts: null,
      reason: 'Счёт',
    });

    const moved = correctionBody({ ...form, validFrom: '2026-10-01T12:00' });
    expect(moved.validFrom).toBe('2026-10-01T09:00:00.000Z');
  });

  it('без записи: текущая минута по Москве, пустой закуп в рублях', () => {
    const form = toCorrectionForm(null, new Date('2026-11-11T10:07:59.900Z'));
    expect(form).toMatchObject({
      validFrom: '2026-11-11T13:07',
      exactValidFrom: null,
      price: '',
      currency: 'RUR',
      reason: '',
    });
  });

  it('валюта записи — с курсом, дробная цена через запятую', () => {
    const form = toCorrectionForm(
      costRecord({ purchase: { price: 12.5, currency: 'USD', rate: 90.5, extraCosts: 40 } }),
      new Date(),
    );
    expect(form).toMatchObject({ price: '12,5', currency: 'USD', rate: '90,5', extraCosts: '40' });
  });

  it('ошибка 400 — под своё поле; чужой товар и сеть — общей строкой', () => {
    expect(
      mapCostCorrectionError(
        new ApiError('Укажите причину исправления', 400, 'INVALID_COST_CORRECTION', 'reason'),
        'x',
      ),
    ).toEqual({ reason: 'Укажите причину исправления' });
    expect(
      mapCostCorrectionError(new ApiError('Товар не найден', 404, 'COST_PRODUCT_NOT_FOUND'), 'x'),
    ).toEqual({ form: 'Товар не найден' });
    expect(mapCostCorrectionError('boom', 'Не удалось')).toEqual({ form: 'Не удалось' });
  });
});
