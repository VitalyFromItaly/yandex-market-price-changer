import { describe, it, expect } from 'vitest';

import type { IWarehousesScreenData } from '../../src/modules/yandex/warehouses/warehouses-message';
import type { TFbyStockType } from '../../src/modules/yandex/fby/fby-stock-report';

import { FBY_STOCK_TYPES } from '../../src/modules/yandex/fby/fby-stock-report';
import { formatWarehousesOverview } from '../../src/modules/yandex/warehouses/warehouses-message';

/**
 * Текст обзора складов. Проверяем разбивку по типам, остатки под каждым складом
 * Маркета, экранирование данных из Маркета и то, что снимок несёт момент съёмки —
 * сверять с кабинетом нечем без времени.
 */
describe('formatWarehousesOverview', () => {
  const NOW = new Date('2026-08-01T06:30:00Z'); // 09:30 МСК
  const TAKEN = new Date('2026-08-01T06:28:00Z'); // 09:28 МСК

  /** Остатки одного склада: перечисляем только ненулевые типы. */
  const stock = (values: Partial<Record<TFbyStockType, number>>) => {
    const totals = {} as Record<TFbyStockType, number>;
    for (const type of FBY_STOCK_TYPES) totals[type] = values[type] ?? 0;
    return totals;
  };

  const screen = (over: Partial<IWarehousesScreenData> = {}): IWarehousesScreenData => ({
    overview: { fulfillment: [], store: [] },
    byWarehouse: null,
    ...over,
  });

  it('печатает оба типа складов с их пометками', () => {
    const text = formatWarehousesOverview(
      screen({
        overview: {
          fulfillment: [{ id: 100, name: 'Софьино', type: 'fby', address: 'Москва, Софьино' }],
          store: [
            { id: 7, name: 'Основной', type: 'store', express: false, groupName: 'Единый остаток' },
            { id: 8, name: 'Экспресс-точка', type: 'store', express: true },
          ],
        },
      }),
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
      screen({ overview: { fulfillment: [], store: [{ id: 1, name: 'Склад', type: 'store' }] } }),
      NOW,
    );
    // У FBY складов нет — так и написано, продавец видит, что раздел не потерян.
    expect(text).toContain('— нет');
  });

  it('совсем без складов — отдельный текст, а не пустые секции', () => {
    const text = formatWarehousesOverview(screen(), NOW);
    expect(text).toContain('не найдено ни одного склада');
  });

  it('экранирует названия и адреса из Маркета', () => {
    // Символ < в названии иначе сломал бы разметку ВСЕГО сообщения (Telegram 400).
    const text = formatWarehousesOverview(
      screen({ overview: { fulfillment: [], store: [{ id: 1, name: 'A<b> & Co', type: 'store' }] } }),
      NOW,
    );
    expect(text).toContain('A&lt;b&gt; &amp; Co');
    expect(text).not.toContain('A<b> & Co');
  });

  it('идентификаторы кампании и бизнеса в тексте не встречаются', () => {
    // id склада печатать можно, а campaign_id/business_id — нельзя. Здесь их
    // просто нет во входе, проверяем, что формат их и не выдумывает.
    const text = formatWarehousesOverview(
      screen({ overview: { fulfillment: [{ id: 100, name: 'Софьино', type: 'fby' }], store: [] } }),
      NOW,
    );
    expect(text).toContain('id 100');
    expect(text).not.toMatch(/campaign|business/i);
  });

  describe('остатки под складом', () => {
    const FULFILLMENT = [
      { id: 100, name: 'Софьино', type: 'fby' as const },
      { id: 147, name: 'Ростов-на-Дону-1', type: 'fby' as const },
    ];

    it('совпавший склад показывает только ненулевые типы, пустой — «пусто»', () => {
      const text = formatWarehousesOverview(
        screen({
          overview: { fulfillment: FULFILLMENT, store: [] },
          byWarehouse: { Софьино: stock({ AVAILABLE: 1234, FREEZE: 12 }) },
          stockTakenAt: TAKEN,
        }),
        NOW,
      );

      expect(text).toContain('доступно <b>1 234</b>');
      expect(text).toContain('резерв <b>12</b>');
      // Нулевые типы не перечисляются — экран и без них длинный.
      expect(text).not.toContain('карантин');
      // Склад Маркета без остатков остаётся на экране: он существует.
      expect(text).toContain('Ростов-на-Дону-1');
      expect(text).toContain('пусто');
    });

    it('склад из отчёта, которого нет в списке, печатается своим именем', () => {
      const text = formatWarehousesOverview(
        screen({
          overview: { fulfillment: FULFILLMENT, store: [] },
          byWarehouse: { 'Новая площадка <X>': stock({ AVAILABLE: 12 }) },
          stockTakenAt: TAKEN,
        }),
        NOW,
      );

      // Имя приходит прямо из ячейки CSV — экранирование обязательно.
      expect(text).toContain('Новая площадка &lt;X&gt;');
      expect(text).toContain('нет в списке складов Маркета');
    });

    it('итог равен сумме показанных строк', () => {
      const text = formatWarehousesOverview(
        screen({
          overview: { fulfillment: FULFILLMENT, store: [] },
          byWarehouse: {
            Софьино: stock({ AVAILABLE: 1234, FREEZE: 12 }),
            'Ростов-на-Дону-1': stock({ AVAILABLE: 300 }),
            'Новая площадка': stock({ AVAILABLE: 12 }),
          },
          stockTakenAt: TAKEN,
        }),
        NOW,
      );

      expect(text).toContain('Итого: доступно <b>1 546</b> · резерв <b>12</b>');
    });

    it('печатает момент съёмки остатков отдельно от момента экрана', () => {
      const text = formatWarehousesOverview(
        screen({
          overview: { fulfillment: FULFILLMENT, store: [] },
          byWarehouse: { Софьино: stock({ AVAILABLE: 1 }) },
          stockTakenAt: TAKEN,
        }),
        NOW,
      );

      // Шапка — момент сборки экрана, строка блока — момент отчёта.
      expect(text).toContain('на 01-08-2026 09:30 МСК');
      expect(text).toContain('из отчёта Маркета на 01-08-2026 09:28 МСК');
    });

    it('остатки недоступны — список складов остаётся, добавляется причина', () => {
      const rateLimited = formatWarehousesOverview(
        screen({
          overview: { fulfillment: FULFILLMENT, store: [] },
          byWarehouse: null,
          stockError: 'rate_limit',
        }),
        NOW,
      );

      expect(rateLimited).toContain('Остатки обновляются, попробуйте через минуту');
      expect(rateLimited).toContain('Софьино');
      expect(rateLimited).toContain('id 147');
      // Ни «пусто», ни «Итого»: нулей мы не видели, а видели отсутствие ответа.
      expect(rateLimited).not.toContain('пусто');
      expect(rateLimited).not.toContain('Итого');

      const generic = formatWarehousesOverview(
        screen({ overview: { fulfillment: FULFILLMENT, store: [] }, byWarehouse: null }),
        NOW,
      );
      expect(generic).toContain('Остатки временно недоступны');
    });
  });
});
