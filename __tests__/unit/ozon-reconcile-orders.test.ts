import { describe, expect, it, vi } from 'vitest';

import type { IOzonPosting } from '../../src/modules/ozon/ozon.client';

import { monthPeriod } from '../../src/modules/finance/finance-period';
import { ozonReconcileOrders } from '../../src/modules/ozon/ozon-reconcile-orders';

const NOW = new Date('2026-10-18T07:00:00Z');
const SEPT = monthPeriod(2026, 9);

const posting = (number: string, inProcessAt: string, status = 'delivered'): IOzonPosting => ({
  postingNumber: number,
  orderNumber: number.split('-')[0],
  status,
  substatus: '',
  inProcessAt,
  products: [],
});

function fakeClient(fbs: IOzonPosting[], fbo: IOzonPosting[] = []) {
  const inWindow = (list: IOzonPosting[]) => async (since: Date, to: Date) =>
    list.filter((p) => {
      const at = Date.parse(p.inProcessAt);
      return at >= since.getTime() && at <= to.getTime();
    });
  return {
    listFbsPostings: vi.fn(inWindow(fbs)),
    listFboPostings: vi.fn(inWindow(fbo)),
  };
}

describe('ozonReconcileOrders', () => {
  const client = () =>
    fakeClient(
      [
        posting('1-1-1', '2026-09-05T10:00:00Z'),
        // 30.09 23:30 по Москве — ещё сентябрь.
        posting('2-1-1', '2026-09-30T20:30:00Z'),
        // 01.10 00:30 по Москве — уже октябрь.
        posting('3-1-1', '2026-09-30T21:30:00Z'),
        posting('4-1-1', '2026-08-20T10:00:00Z'),
        posting('5-1-1', '2026-09-07T10:00:00Z', 'cancelled'),
        posting('6-1-1', '2026-09-08T10:00:00Z', 'delivering'),
      ],
      [posting('7-1-1', '2026-09-09T10:00:00Z')],
    );

  it('выкуплено в месяце — оформлено в нём по Москве и delivered, FBS и FBO', async () => {
    const orders = ozonReconcileOrders(client() as never, NOW);
    expect([...(await orders.deliveredIn(SEPT))].sort()).toEqual(['1-1-1', '2-1-1', '7-1-1']);
  });

  it('существует — любое отправление окна, и отменённое; обход один на оба вопроса', async () => {
    const fake = client();
    const orders = ozonReconcileOrders(fake as never, NOW);
    await orders.deliveredIn(SEPT);
    const found = await orders.existing(['4-1-1', '5-1-1', '6-1-1', '404-1-1'], SEPT);
    expect([...found].sort()).toEqual(['4-1-1', '5-1-1', '6-1-1']);

    // Окно — 120 дней до месяца и сам месяц: ≤ 30 дней на запрос, без повторного обхода.
    const calls = fake.listFbsPostings.mock.calls;
    expect(calls.length).toBe(fake.listFboPostings.mock.calls.length);
    expect(calls.length).toBe(5);
    expect(calls[0][0].toISOString()).toBe('2026-05-03T21:00:00.000Z');
    expect(calls[calls.length - 1][1].toISOString()).toBe('2026-09-30T20:59:59.000Z');
  });
});
