import { describe, it, expect } from 'vitest';

import {
  decidePick,
  groupByBusiness,
  uniqueLabels,
} from '../../src/modules/telegram/bots/price-changer-bot/store-picker';

const store = (
  campaignId: string,
  businessId: string,
  businessName: string,
  storeName: string,
) => ({
  campaignId,
  businessId,
  businessName,
  storeName,
});

describe('decidePick: сколько вопросов задать', () => {
  it('один магазин — подключается сам, вопросов нет', () => {
    const s = store('1', '10', 'Кабинет', 'shop.ru');
    expect(decidePick([s])).toEqual({ kind: 'single', store: s });
  });

  it('один кабинет с двумя магазинами — сразу выбор магазина, БЕЗ лишнего шага', () => {
    // Спрашивать «выберите кабинет», когда он один, — вопрос без вариантов.
    const pick = decidePick([
      store('1', '10', 'Кабинет', 'first.ru'),
      store('2', '10', 'Кабинет', 'second.ru'),
    ]);
    expect(pick.kind).toBe('store');
  });

  it('несколько кабинетов — сначала кабинет', () => {
    const pick = decidePick([
      store('1', '10', 'Первый', 'a.ru'),
      store('2', '20', 'Второй', 'b.ru'),
    ]);
    expect(pick.kind).toBe('business');
    if (pick.kind === 'business') {
      expect(pick.groups).toHaveLength(2);
    }
  });

  it('пусто — нечего подключать', () => {
    expect(decidePick([])).toEqual({ kind: 'none' });
  });
});

describe('groupByBusiness', () => {
  it('магазины одного кабинета собираются вместе', () => {
    const groups = groupByBusiness([
      store('1', '10', 'Кабинет А', 'a1.ru'),
      store('2', '20', 'Кабинет Б', 'b1.ru'),
      store('3', '10', 'Кабинет А', 'a2.ru'),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].stores.map((s) => s.campaignId)).toEqual(['1', '3']);
    expect(groups[1].stores.map((s) => s.campaignId)).toEqual(['2']);
  });

  it('порядок кабинетов сохраняется как пришёл из API', () => {
    const groups = groupByBusiness([
      store('1', '99', 'Второй по номеру', 'x.ru'),
      store('2', '11', 'Первый по номеру', 'y.ru'),
    ]);
    expect(groups.map((g) => g.businessId)).toEqual(['99', '11']);
  });
});

describe('uniqueLabels: подписи кнопок различимы', () => {
  it('одинаковые подписи нумеруются — иначе выбор превращается в лотерею', () => {
    // Два магазина с одним доменом выглядели бы как одна и та же кнопка.
    expect(uniqueLabels(['shop.ru', 'shop.ru', 'other.ru'])).toEqual([
      'shop.ru',
      'shop.ru (2)',
      'other.ru',
    ]);
  });

  it('уникальные подписи не трогаются', () => {
    expect(uniqueLabels(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('после нумерации все подписи различны', () => {
    const result = uniqueLabels(['x', 'x', 'x']);
    expect(new Set(result).size).toBe(3);
  });

  it('пустой список не ломает функцию', () => {
    expect(uniqueLabels([])).toEqual([]);
  });
});
