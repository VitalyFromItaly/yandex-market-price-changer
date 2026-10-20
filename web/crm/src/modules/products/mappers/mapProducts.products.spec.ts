import { describe, expect, it } from 'vitest';

import {
  formatAuthor,
  formatPurchase,
  formatValidFrom,
  mapProductsPage,
  mapPurchaseError,
  purchaseBody,
  toPurchaseForm,
} from './mapProducts.products';

import { ApiError } from '@/shared/http';

describe('маппер «Товаров»', () => {
  it('страницы считаются от total и limit; пусто — одна', () => {
    const page = mapProductsPage({
      total: 101,
      totalAll: 500,
      page: 2,
      limit: 50,
      brands: [],
      items: [],
      currencies: ['RUR'],
    });
    expect(page).toMatchObject({ pages: 3, page: 2, totalAll: 500 });
    expect(mapProductsPage({ ...page, limit: 50, total: 0, currencies: [] }).pages).toBe(1);
  });

  it('закуп словами: рубли, валюта с курсом, доп. расходы; нет — прочерк', () => {
    expect(formatPurchase(null)).toBe('—');
    expect(formatPurchase({ price: 12.5, currency: 'USD', rate: 90, extraCosts: 40 })).toMatch(
      /^12,5 \$ × 90 ₽ \+ 40\s₽ доп\.$/,
    );
    expect(formatPurchase({ price: 1000, currency: 'RUR', rate: null, extraCosts: null })).toMatch(
      /^1\s000\s₽$/,
    );
  });

  it('дата записи и автор', () => {
    expect(formatValidFrom(null)).toBe('с начала');
    expect(formatValidFrom('2026-10-17')).toBe('с 17-10-2026');
    expect(formatAuthor('777', '777')).toBe('вы');
    expect(formatAuthor('777', '1')).toBe('777');
    expect(formatAuthor(null, '1')).toBe('—');
  });

  it('форма ↔ тело: у рублей курса нет, пустое — null, запятая сохраняется до сервера', () => {
    const form = toPurchaseForm(null);
    expect(form).toEqual({ price: '', currency: 'RUR', rate: '', extraCosts: '' });
    expect(purchaseBody({ price: ' 12,5 ', currency: 'USD', rate: '90', extraCosts: '' })).toEqual({
      price: '12,5',
      currency: 'USD',
      rate: '90',
      extraCosts: null,
    });
    expect(
      purchaseBody({ price: '1', currency: 'RUR', rate: '90', extraCosts: '5' }).rate,
    ).toBeNull();
  });

  it('ошибка INVALID_PURCHASE — под своим полем, остальное — строкой формы', () => {
    const field = new ApiError('Нужен курс', 400, 'INVALID_PURCHASE', 'rate');
    expect(mapPurchaseError(field, 'x')).toEqual({ rate: 'Нужен курс' });
    expect(mapPurchaseError(new Error('сеть'), 'x')).toEqual({ form: 'сеть' });
  });
});
