import { describe, it, expect } from 'vitest';

import {
  FBY_PROBLEM_INLINE_LIMIT,
  formatFbyOverview,
  type IFbyOverviewData,
} from '../../src/modules/yandex/fby/fby-message';
import type {
  IFbyProblemSku,
  IFbyStockSummary,
  TFbyStockType,
} from '../../src/modules/yandex/fby/fby-stock-report';

const NOW = new Date('2026-08-02T06:30:00Z'); // 09:30 МСК

function stock(problems: IFbyProblemSku[] = [], byWarehouse: IFbyStockSummary['byWarehouse'] = {}) {
  return {
    totals: {
      AVAILABLE: 253,
      FIT: 280,
      FREEZE: 29,
      QUARANTINE: 1,
      DEFECT: 8,
      EXPIRED: 0,
      UTILIZATION: 0,
    },
    problems,
    byWarehouse,
  };
}

/** Итоги одного склада: все типы нули, кроме переданных. */
function wh(counts: Partial<Record<TFbyStockType, number>>): Record<TFbyStockType, number> {
  return {
    AVAILABLE: 0,
    FIT: 0,
    FREEZE: 0,
    QUARANTINE: 0,
    DEFECT: 0,
    EXPIRED: 0,
    UTILIZATION: 0,
    ...counts,
  };
}

function fullData(overrides: Partial<IFbyOverviewData> = {}): IFbyOverviewData {
  return {
    stock: stock(),
    requests: [],
    inTransit: 12,
    returning: 3,
    ...overrides,
  };
}

describe('formatFbyOverview', () => {
  it('печатает остатки по типам и снимок со временем МСК', () => {
    const text = formatFbyOverview(fullData(), NOW);
    expect(text).toContain('FBY');
    expect(text).toContain('МСК');
    expect(text).toContain('Доступно к заказу');
    expect(text).toContain('253');
    expect(text).toContain('Брак');
    expect(text).toContain('Едет до клиента');
    expect(text).toContain('12'); // едет до клиента
  });

  it('проблемные до порога печатаются списком с разбивкой по типам', () => {
    const text = formatFbyOverview(
      fullData({
        stock: stock([
          { sku: 'A159W-N1', name: 'Часы A159W-N1', defect: 2, expired: 1, utilization: 0 },
        ]),
      }),
      NOW,
    );
    expect(text).toContain('A159W-N1');
    expect(text).toContain('брак 2');
    expect(text).toContain('просрочка 1');
    // Файл приходит всегда — на него указывает общая строка, а список при этом
    // остаётся в сообщении.
    expect(text).toContain('в файле');
  });

  it('проблемных больше порога — список не печатается, файл всё равно есть', () => {
    const many: IFbyProblemSku[] = Array.from({ length: FBY_PROBLEM_INLINE_LIMIT + 1 }, (_, i) => ({
      sku: `SKU${i}`,
      name: `Часы ${i}`,
      defect: 1,
      expired: 0,
      utilization: 0,
    }));
    const text = formatFbyOverview(fullData({ stock: stock(many) }), NOW);
    expect(text).toContain('в файле');
    expect(text).not.toContain('SKU0 ');
  });

  it('нет проблемных — так и пишет', () => {
    const text = formatFbyOverview(fullData({ stock: stock([]) }), NOW);
    expect(text).toContain('Проблемных позиций нет');
  });

  it('остатки по кластерам: склады одной территории складываются в одну строку', () => {
    const text = formatFbyOverview(
      fullData({
        stock: stock([], {
          Софьино: wh({ AVAILABLE: 1200, FREEZE: 50 }),
          Томилино: wh({ AVAILABLE: 34, FREEZE: 6, DEFECT: 7 }),
          Екатеринбург: wh({ AVAILABLE: 27, EXPIRED: 2 }),
        }),
      }),
      NOW,
    );

    // Софьино и Томилино — одна Москва; нулевые типы в строку не попадают.
    expect(text).toContain('📍 Москва: доступно <b>1 234</b> · резерв <b>56</b> · брак <b>7</b>');
    expect(text).toContain('📍 Екатеринбург: доступно <b>27</b> · просрочка <b>2</b>');
    expect(text).not.toContain('Софьино');
  });

  it('склад вне реестра — отдельной строкой со своим именем, через esc', () => {
    const text = formatFbyOverview(
      fullData({
        stock: stock([], {
          Софьино: wh({ AVAILABLE: 5 }),
          'Новый склад <X>': wh({ AVAILABLE: 12 }),
        }),
      }),
      NOW,
    );

    expect(text).toContain('📍 Новый склад &lt;X&gt;: доступно <b>12</b>');
    expect(text).not.toContain('Новый склад <X>');
  });

  it('кластер со сплошными нулями показывается как «пусто», а не исчезает', () => {
    const text = formatFbyOverview(fullData({ stock: stock([], { Софьино: wh({}) }) }), NOW);
    expect(text).toContain('📍 Москва: пусто');
  });

  it('без данных по складам кластерных строк нет (пустой byWarehouse)', () => {
    const text = formatFbyOverview(fullData({ stock: stock([], {}) }), NOW);
    expect(text).not.toContain('📍');
  });

  it('заявки печатаются с номером, статусом и складом; неизвестный статус — как есть', () => {
    const text = formatFbyOverview(
      fullData({
        requests: [
          {
            id: '31747879',
            type: 'WITHDRAW',
            status: 'READY_TO_WITHDRAW',
            defectCount: 5,
            planCount: 10,
            targetName: 'Яндекс.Маркет (Домодедово возвратный)',
          },
          {
            id: '42',
            type: 'WITHDRAW',
            status: 'SOME_NEW_STATUS',
            defectCount: 0,
            planCount: 1,
          },
        ],
      }),
      NOW,
    );
    expect(text).toContain('31747879');
    expect(text).toContain('готово забрать');
    expect(text).toContain('брак 5');
    expect(text).toContain('Домодедово возвратный');
    // Неизвестный статус показывается сырым кодом, а не теряется.
    expect(text).toContain('SOME_NEW_STATUS');
  });

  it('готовые к вывозу заявки идут первыми, завершённые — последними', () => {
    // Заявок бывают десятки, в сообщение влезает часть — actionable «готово
    // забрать» не должно тонуть среди завершённых.
    const text = formatFbyOverview(
      fullData({
        requests: [
          { id: 'DONE', type: 'WITHDRAW', status: 'FINISHED', defectCount: 0, planCount: 1 },
          {
            id: 'READY',
            type: 'WITHDRAW',
            status: 'READY_TO_WITHDRAW',
            defectCount: 0,
            planCount: 1,
          },
        ],
      }),
      NOW,
    );
    expect(text.indexOf('READY')).toBeLessThan(text.indexOf('DONE'));
  });

  it('каждый источник деградирует независимо, а не рушит экран', () => {
    const text = formatFbyOverview(
      { stock: null, stockError: 'generic', requests: null, inTransit: null, returning: null },
      NOW,
    );
    expect(text).toContain('Остатки временно недоступны');
    expect(text).toContain('Заявки временно недоступны');
    expect(text).toContain('недоступно'); // счётчики доставки
    expect(text).not.toContain('📍'); // без остатков нет и кластерных строк
    // Шапка на месте — экран собран, а не упал.
    expect(text).toContain('FBY');
  });

  it('rate-limit остатков даёт особую заглушку «попробуйте через минуту»', () => {
    const text = formatFbyOverview(fullData({ stock: null, stockError: 'rate_limit' }), NOW);
    expect(text).toContain('через минуту');
  });

  it('экранирует названия и склады из Маркета и не печатает id кампании/бизнеса', () => {
    const text = formatFbyOverview(
      fullData({
        stock: stock([{ sku: 'X', name: 'A<b> & Co', defect: 1, expired: 0, utilization: 0 }]),
        requests: [
          {
            id: '1',
            type: 'WITHDRAW',
            status: 'CREATED',
            defectCount: 0,
            planCount: 1,
            targetName: 'A<b>',
          },
        ],
      }),
      NOW,
    );
    expect(text).toContain('A&lt;b&gt; &amp; Co');
    expect(text).not.toContain('A<b> & Co');
    expect(text).not.toMatch(/campaign|business/i);
  });
});
