import type { ICrmWarehousesView } from '../../src/modules/crm/warehouses/crm-warehouses.domain';
import type { IWarehousesScreenData } from '../../src/modules/yandex/warehouses/warehouses-message';

import { describe, expect, it, vi } from 'vitest';

import { CrmJobsRegistry } from '../../src/modules/crm/jobs/crm-jobs.registry';
import {
  toCrmWarehousesView,
  WAREHOUSES_JOB_KIND,
} from '../../src/modules/crm/warehouses/crm-warehouses.domain';
import { CrmWarehousesKinds } from '../../src/modules/crm/warehouses/crm-warehouses.kinds';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { formatWarehousesOverview } from '../../src/modules/yandex/warehouses/warehouses-message';

const NOW = new Date('2026-09-24T10:05:00+03:00');
const zero = {
  AVAILABLE: 0,
  FIT: 0,
  FREEZE: 0,
  QUARANTINE: 0,
  DEFECT: 0,
  EXPIRED: 0,
  UTILIZATION: 0,
};

const DATA: IWarehousesScreenData = {
  overview: {
    fulfillment: [
      { id: 147, name: 'Ростов-на-Дону-1', type: 'fby', address: 'ул. Складская' },
      { id: 300, name: 'Пустой', type: 'fby' },
    ],
    store: [{ id: 1826207, name: 'Мой склад', type: 'store', express: true, groupName: 'Юг' }],
  },
  byWarehouse: {
    'Ростов-на-Дону-1': { ...zero, AVAILABLE: 10, FREEZE: 2 },
    Призрак: { ...zero, AVAILABLE: 3 },
  },
  stockTakenAt: new Date('2026-09-24T10:04:00+03:00'),
};

describe('kind «Склады» в CRM (TASK-086)', () => {
  it('зарегистрирован под FBY-only фичей warehouses, файла нет', async () => {
    const registry = new CrmJobsRegistry();
    const overview = vi.fn(async () => DATA);
    const kinds = new CrmWarehousesKinds(registry, { overview } as never);
    kinds.onModuleInit();

    expect(registry.get(WAREHOUSES_JOB_KIND)?.features).toEqual([FEATURE.WAREHOUSES]);
    const output = await kinds.run(
      { telegramUserId: '1', store: {} as never, params: {}, features: {} },
      NOW,
    );
    expect(output.file).toBeNull();
    expect((output.data as ICrmWarehousesView).fby).toHaveLength(3);
  });

  it('строки — joinWarehouseStock: совпавший, «пусто», «нет в списке»', () => {
    const view = toCrmWarehousesView(DATA, NOW);
    const byName = Object.fromEntries(view.fby.map((row) => [row.name, row]));

    expect(byName['Ростов-на-Дону-1']).toMatchObject({ origin: 'matched', ids: [147], count: 12 });
    expect(byName['Пустой']).toMatchObject({ origin: 'list-only', count: 0, address: null });
    expect(byName['Призрак']).toMatchObject({ origin: 'report-only', ids: [] });
    expect(view.notInListLabel).toBe('нет в списке складов Маркета');
    expect(view.stockTakenAt).toBe('24-09-2026 10:04');
    expect(view.store[0]).toMatchObject({ express: true, groupName: 'Юг', address: null });
    expect(view.emptyText).toBeNull();
  });

  it('«Итого» — сумма показанных строк, та же, что у бота', () => {
    const view = toCrmWarehousesView(DATA, NOW);
    expect(view.sum).toMatchObject({ AVAILABLE: 13, FREEZE: 2 });
    expect(formatWarehousesOverview(DATA, NOW)).toContain(
      'Итого: доступно <b>13</b> · резерв <b>2</b>',
    );
  });

  it('отчёта нет — sum null, totals null, причина без значка', () => {
    const view = toCrmWarehousesView(
      { overview: DATA.overview, byWarehouse: null, stockError: 'generic' },
      NOW,
    );
    expect(view.sum).toBeNull();
    expect(view.fby.every((row) => row.totals === null)).toBe(true);
    expect(view.stockProblem).toBe('Остатки временно недоступны.');
  });

  it('складов нет вовсе — emptyText бота', () => {
    const view = toCrmWarehousesView(
      { overview: { fulfillment: [], store: [] }, byWarehouse: {} },
      NOW,
    );
    expect(view.emptyText).toBe('У этого магазина не найдено ни одного склада.');
  });
});
