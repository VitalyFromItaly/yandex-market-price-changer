import { describe, it, expect } from 'vitest';

import { formatWarehousesOverview } from '../../src/modules/yandex/warehouses/warehouses-message';

/**
 * Текст обзора складов. Проверяем разбивку по типам, экранирование данных из
 * Маркета и то, что снимок несёт момент съёмки — сверять с кабинетом нечем без
 * времени.
 */
describe('formatWarehousesOverview', () => {
  const NOW = new Date('2026-08-01T06:30:00Z'); // 09:30 МСК

  it('печатает оба типа складов с их пометками', () => {
    const text = formatWarehousesOverview(
      {
        fulfillment: [{ id: 100, name: 'Софьино', type: 'fby', address: 'Москва, Софьино' }],
        store: [
          { id: 7, name: 'Основной', type: 'store', express: false, groupName: 'Единый остаток' },
          { id: 8, name: 'Экспресс-точка', type: 'store', express: true },
        ],
      },
      NOW,
    );

    expect(text).toContain('FBY');
    expect(text).toContain('Софьино');
    expect(text).toContain('id 100');
    expect(text).toContain('Склад магазина');
    expect(text).toContain('id 7');
    expect(text).toContain('Экспресс');
    expect(text).toContain('группа «Единый остаток»');
    // Снимок с моментом съёмки.
    expect(text).toContain('МСК');
  });

  it('пустой тип помечается «нет», а не пропадает молча', () => {
    const text = formatWarehousesOverview(
      { fulfillment: [], store: [{ id: 1, name: 'Склад', type: 'store' }] },
      NOW,
    );
    // У FBY складов нет — так и написано, продавец видит, что раздел не потерян.
    expect(text).toContain('— нет');
  });

  it('совсем без складов — отдельный текст, а не пустые секции', () => {
    const text = formatWarehousesOverview({ fulfillment: [], store: [] }, NOW);
    expect(text).toContain('не найдено ни одного склада');
  });

  it('экранирует названия и адреса из Маркета', () => {
    // Символ < в названии иначе сломал бы разметку ВСЕГО сообщения (Telegram 400).
    const text = formatWarehousesOverview(
      { fulfillment: [], store: [{ id: 1, name: 'A<b> & Co', type: 'store' }] },
      NOW,
    );
    expect(text).toContain('A&lt;b&gt; &amp; Co');
    expect(text).not.toContain('A<b> & Co');
  });

  it('идентификаторы кампании и бизнеса в тексте не встречаются', () => {
    // id склада печатать можно, а campaign_id/business_id — нельзя. Здесь их
    // просто нет во входе, проверяем, что формат их и не выдумывает.
    const text = formatWarehousesOverview(
      { fulfillment: [{ id: 100, name: 'Софьино', type: 'fby' }], store: [] },
      NOW,
    );
    expect(text).toContain('id 100');
    expect(text).not.toMatch(/campaign|business/i);
  });
});
