import { describe, expect, it } from 'vitest';

import {
  manualBody,
  newClientKey,
  toManualForm,
  toManualRow,
} from './mapManualOperations.accounting';

describe('mapManualOperations', () => {
  it('тело запроса: пустые поля — null, текст обрезан', () => {
    const form = {
      ...toManualForm(null, '2026-11-08'),
      amount: ' -1500 ',
      source: ' Акт ',
      orderId: ' ',
    };
    expect(manualBody(form, 'key')).toMatchObject({
      clientKey: 'key',
      amount: '-1500',
      source: 'Акт',
      orderId: null,
      subArticle: null,
    });
    expect(manualBody(form)).not.toHaveProperty('clientKey');
  });

  it('строка таблицы: знак суммы, статья с подстатьёй, заказ и документ', () => {
    const row = toManualRow({
      id: 'm1',
      marketplace: 'ym',
      marketplaceLabel: 'Яндекс Маркет',
      article: 'compensations',
      articleLabel: 'Компенсации',
      subArticle: 'loss_compensation',
      subArticleLabel: 'Компенсация утраты или порчи',
      amountKopecks: 150050,
      accruedOn: '2026-10-15',
      orderId: '123',
      sku: null,
      source: 'Письмо',
      documentNumber: 'SR-1',
      note: null,
      createdAt: '',
      updatedAt: '',
    });
    expect(row).toMatchObject({
      income: true,
      articleLabel: 'Компенсации · Компенсация утраты или порчи',
      refLabel: 'заказ 123',
      sourceLabel: 'Письмо · № SR-1',
    });
    expect(row.amountLabel.startsWith('+')).toBe(true);
  });

  it('ключ формы — uuid', () => {
    expect(newClientKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
