import { describe, it, expect } from 'vitest';

import type { IQuarantineOffer } from '../../src/modules/yandex/quarantine/quarantine.domain';

import {
  QUARANTINE_SHOW_LIMIT,
  quarantineKeyboardRows,
  quarantineText,
  verdictLine,
} from '../../src/modules/yandex/quarantine/quarantine-message';

const offer = (offerId: string): IQuarantineOffer => ({
  offerId,
  verdicts: [{ type: 'PRICE_CHANGE', currentPrice: 990, lastValidPrice: 9900 }],
});

describe('Экран карантина', () => {
  it('печатает артикул и причину с ценами', () => {
    const text = quarantineText([offer('Casio GA-2100')]);
    expect(text).toContain('Casio GA-2100');
    expect(text).toContain('990');
    // Intl для ru-RU разделяет разряды НЕРАЗРЫВНЫМ пробелом.
    expect(text).toContain('9 900');
    expect(text).toContain('скрыты с витрины');
  });

  it('HTML в артикуле экранируется', () => {
    const text = quarantineText([offer('<b>X</b>')]);
    expect(text).not.toContain('<b>X</b>');
    expect(text).toContain('&lt;b&gt;');
  });

  it('длинный список обрезается с пометкой «и ещё N»', () => {
    const offers = Array.from({ length: QUARANTINE_SHOW_LIMIT + 7 }, (_, i) => offer(`SKU-${i}`));
    const text = quarantineText(offers);
    expect(text).toContain(`и ещё 7`);
    expect(text).not.toContain(`SKU-${QUARANTINE_SHOW_LIMIT}`);
  });

  it('LOW_PRICE печатает порог, PRICE_CHANGE — «была → стала»', () => {
    expect(verdictLine({ type: 'LOW_PRICE', currentPrice: 500, minPrice: 1200 })).toContain(
      'при пороге',
    );
    expect(
      verdictLine({ type: 'PRICE_CHANGE', currentPrice: 990, lastValidPrice: 9900 }),
    ).toContain('→');
  });

  it('неизвестный тип вердикта печатается кодом, а не падает', () => {
    expect(verdictLine({ type: 'NEW_VERDICT' })).toContain('NEW_VERDICT');
  });
});

describe('Кнопки карантина', () => {
  it('по кнопке на видимый товар плюс «все»', () => {
    const rows = quarantineKeyboardRows([offer('A'), offer('B'), offer('C')]);
    const buttons = rows.flat();
    expect(buttons.map((b) => b.callback_data)).toEqual(['pq:ok:0', 'pq:ok:1', 'pq:ok:2', 'pq:all']);
  });

  it('один товар — без кнопки «все»', () => {
    const buttons = quarantineKeyboardRows([offer('A')]).flat();
    expect(buttons.map((b) => b.callback_data)).toEqual(['pq:ok:0']);
  });

  it('кнопки не выходят за предел показа', () => {
    const offers = Array.from({ length: QUARANTINE_SHOW_LIMIT + 5 }, (_, i) => offer(`S${i}`));
    const buttons = quarantineKeyboardRows(offers).flat();
    // Видимые + одна «все».
    expect(buttons).toHaveLength(QUARANTINE_SHOW_LIMIT + 1);
    expect(buttons.at(-1).callback_data).toBe('pq:all');
  });
});
