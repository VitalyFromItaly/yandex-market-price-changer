import { describe, it, expect } from 'vitest';

import {
  FBY_PROBLEM_INLINE_LIMIT,
  formatFbyOverview,
  type IFbyOverviewData,
} from '../../src/modules/yandex/fby/fby-message';
import type { IFbyProblemSku } from '../../src/modules/yandex/fby/fby-stock-report';

const NOW = new Date('2026-08-02T06:30:00Z'); // 09:30 МСК

function stock(problems: IFbyProblemSku[] = []) {
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
    expect(text).not.toContain('в файле');
  });

  it('проблемных больше порога — вместо списка отсылка к файлу', () => {
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
