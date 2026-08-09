import { describe, it, expect } from 'vitest';

import type { IFbySupplyRequest } from '../../src/modules/yandex/yandex-api.client';

import {
  formatFbyOverview,
  type IFbyOverviewData,
} from '../../src/modules/yandex/fby/fby-message';

/**
 * Секция «Поставки на склад Маркета» в сводке FBY — фича fby_supply.
 *
 * Ключевой инвариант — тройная семантика поля supplies: undefined (фича
 * выключена) — секции нет вовсе; null (источник упал) — заглушка; массив —
 * секция. undefined и null здесь РАЗНЫЕ ответы, и перепутать их значит либо
 * показать заглушку всем, у кого фича выключена, либо молча спрятать сбой.
 */

const supply = (overrides: Partial<IFbySupplyRequest> = {}): IFbySupplyRequest => ({
  id: '12345',
  type: 'SUPPLY',
  status: 'ARRIVED_TO_SERVICE',
  defectCount: 0,
  planCount: 100,
  factCount: 0,
  targetName: 'Ростов-на-Дону-1',
  requestedDate: '2026-08-20T10:00:00+03:00',
  ...overrides,
});

const data = (supplies: IFbyOverviewData['supplies']): IFbyOverviewData => ({
  stock: null,
  stockError: 'generic',
  requests: [],
  inTransit: 0,
  returning: 0,
  supplies,
});

describe('Сводка FBY: секция поставок', () => {
  it('undefined — фича выключена, секции нет вовсе', () => {
    const text = formatFbyOverview(data(undefined));
    expect(text).not.toContain('Поставки на склад Маркета');
    expect(text).not.toContain('Поставки временно недоступны');
  });

  it('null — источник упал, заглушка вместо секции', () => {
    const text = formatFbyOverview(data(null));
    expect(text).toContain('⚠️ Поставки временно недоступны.');
  });

  it('поставка печатается со статусом, датой, складом и планом', () => {
    const text = formatFbyOverview(data([supply()]));
    expect(text).toContain('📥');
    expect(text).toContain('12345');
    expect(text).toContain('прибыла на склад');
    expect(text).toContain('20-08-2026');
    expect(text).toContain('Ростов-на-Дону-1');
    expect(text).toContain('план 100');
  });

  it('факт печатается, только когда склад что-то принял', () => {
    expect(formatFbyOverview(data([supply({ factCount: 98 })]))).toContain('план 100 / факт 98');
    expect(formatFbyOverview(data([supply()]))).not.toContain('факт');
  });

  it('транзитный склад xDoc печатается через «через»', () => {
    const text = formatFbyOverview(
      data([supply({ status: 'ARRIVED_TO_XDOC_SERVICE', transitName: 'Софьино xDoc' })]),
    );
    expect(text).toContain('через «Софьино xDoc»');
    expect(text).toContain('на транзитном складе');
  });

  it('терминальные не в списке, но и не спрятаны молча', () => {
    const text = formatFbyOverview(
      data([supply(), supply({ id: '99', status: 'FINISHED' })]),
    );
    expect(text).toContain('Завершённых/отменённых: 1');
    expect(text).not.toContain('№<b>99</b>');
  });

  it('неизвестный статус печатается кодом, а не теряется', () => {
    const text = formatFbyOverview(data([supply({ status: 'BRAND_NEW_STATUS' })]));
    expect(text).toContain('BRAND_NEW_STATUS');
  });
});
