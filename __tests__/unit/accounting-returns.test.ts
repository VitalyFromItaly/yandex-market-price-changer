import type { IComputedOrder } from '../../src/modules/accounting/accounting-order-card.service';
import type { IAccountingOrderLineInput } from '../../src/modules/accounting/accounting-order-lines.domain';
import type { IOrderCardOperation } from '../../src/modules/accounting/accounting-order-card.domain';
import type { TLotSaleCost } from '../../src/modules/accounting/accounting-lots.domain';
import type { ICrmJobContext } from '../../src/modules/crm/jobs/crm-jobs.domain';

import { describe, expect, it, vi } from 'vitest';

import {
  RETURNS_TOP_MODELS,
  repackingSharesOf,
  returnsSummaryOf,
} from '../../src/modules/accounting/accounting-returns.domain';
import { AccountingReturnsService } from '../../src/modules/accounting/accounting-returns.service';
import { ORDER_EXPENSE_METHOD } from '../../src/modules/accounting/expense-binding-allocation';
import { returnResultOf } from '../../src/modules/accounting/return-result';
import {
  ACCOUNTING_RETURNS_BAD_MONTH_TEXT,
  ACCOUNTING_RETURNS_KIND,
} from '../../src/modules/crm/accounting/crm-accounting.domain';
import { CrmAccountingKinds } from '../../src/modules/crm/accounting/crm-accounting.kinds';
import { CrmJobError } from '../../src/modules/crm/jobs/crm-jobs.domain';

/**
 * «Возвраты» «Финучёта» (TASK-225): суммы по площадкам из `returnResultOf`,
 * площадки не смешиваются, неизвестное списание — null, упаковка из карточки,
 * частые модели; сервис — магазин ЯМ из URL; kind — фичи и разбор месяца.
 */

const DAY = new Date('2026-10-05T09:00:00Z');

function op(partial: Partial<IOrderCardOperation>): IOrderCardOperation {
  return {
    id: 'op',
    article: 'commission',
    subArticle: null,
    amountKopecks: 0,
    orderId: '100',
    sku: null,
    serviceName: null,
    transactionType: 'Удержание',
    transactionSource: null,
    accruedAt: DAY,
    paidAt: null,
    actDate: null,
    model: 'FBS',
    count: null,
    marketplace: 'ym',
    origin: 'journal',
    documentId: null,
    ...partial,
  } as IOrderCardOperation;
}

function line(partial: Partial<IAccountingOrderLineInput> = {}): IAccountingOrderLineInput {
  return {
    marketplace: 'ym',
    orderId: '100',
    itemId: '1',
    campaignId: '11',
    offerId: 'A1',
    offerName: 'Товар А',
    count: 1,
    priceKopecks: 100_000,
    buyerPriceKopecks: 100_000,
    buyerPriceBeforeDiscountKopecks: null,
    marketplaceSubsidyKopecks: 0,
    sellerDiscountKopecks: null,
    revenueKopecks: 100_000,
    payoutKopecks: null,
    commissionKopecks: null,
    status: 'DELIVERED',
    substatus: null,
    createdOn: '2026-10-05',
    soldOn: '2026-10-07',
    deliveryOn: null,
    returnedOn: null,
    source: 'ym-orders',
    ...partial,
  };
}

const returned = (partial: Partial<IAccountingOrderLineInput> = {}) =>
  line({ status: 'RETURNED', returnedOn: '2026-10-20', ...partial });

function order(
  lines: IAccountingOrderLineInput[],
  operations: IOrderCardOperation[] = [],
  extra: Partial<IComputedOrder> = {},
): IComputedOrder {
  const { marketplace, orderId } = lines[0];
  return {
    key: `${marketplace}|${orderId}`,
    marketplace,
    orderId,
    lines,
    operations,
    result: { amounts: [] },
    ...extra,
  } as unknown as IComputedOrder;
}

// Возврат ЯМ: продажа и возврат платежа, логистика туда/обратно, комиссия удержана и частично возвращена.
const ymReturn = order(
  [returned()],
  [
    op({ id: 's', article: 'sales', amountKopecks: 100_000, transactionType: 'Начисление' }),
    op({ id: 'r', article: 'returns', amountKopecks: -100_000 }),
    op({ id: 'c1', article: 'commission', amountKopecks: -10_000 }),
    op({ id: 'c2', article: 'commission', amountKopecks: 4_000 }),
    op({ id: 'd', article: 'delivery_to_buyer', amountKopecks: -5_000 }),
    op({ id: 'rl', article: 'reverse_logistics', amountKopecks: -6_000 }),
    op({ id: 'pn', article: 'penalties', amountKopecks: -1_000 }),
    op({ id: 'cp', article: 'compensations', amountKopecks: 2_000 }),
  ],
  {
    result: {
      amounts: [
        {
          key: 'other_expenses',
          expenses: [
            { id: 'e1', title: 'Упаковка', kopecks: -500, method: ORDER_EXPENSE_METHOD },
            { id: 'e2', title: 'Фото', kopecks: -300, method: 'По штукам товара' },
          ],
        },
      ],
    },
  } as never,
);
const ymSold = order([line({ orderId: '101' })]);
const ymSold2 = order([line({ orderId: '102', offerId: 'B2', offerName: 'Товар Б', count: 3 })]);
const ymCancelled = order([line({ orderId: '103', status: 'CANCELLED' })]);
const ozonReturn = order(
  [returned({ marketplace: 'ozon', orderId: 'O-1', offerId: 'OZ', offerName: 'Озон' })],
  [
    op({
      id: 'oz',
      marketplace: 'ozon',
      orderId: 'O-1',
      article: 'reverse_logistics',
      amountKopecks: -7_000,
    }),
  ],
);

describe('returnsSummaryOf — суммы раздела', () => {
  const summary = returnsSummaryOf(
    [ymReturn, ymSold, ymSold2, ymCancelled, ozonReturn],
    ['ym', 'ozon'],
  );
  const ym = summary.marketplaces.find((m) => m.marketplace === 'ym');
  const ozon = summary.marketplaces.find((m) => m.marketplace === 'ozon');

  it('количество и доля — от ушедших покупателю, отменённые не считаются', () => {
    expect(ym).toMatchObject({ label: 'Яндекс Маркет', ordersCount: 3, returnedCount: 1 });
    expect(ym.returnRate).toBeCloseTo(1 / 3);
  });

  it('статьи — из returnResultOf; Σ строк = итог заказа', () => {
    const direct = returnResultOf({
      marketplace: 'ym',
      orderId: '100',
      lines: ymReturn.lines,
      operations: ymReturn.operations,
      expenses: repackingSharesOf(ymReturn),
    });
    expect(ym).toMatchObject({
      returnedValueKopecks: 100_000,
      deliveryKopecks: -5_000,
      reverseKopecks: -6_000,
      withheldKopecks: -6_000 - 1_000,
      compensationsKopecks: 2_000,
      repackingKopecks: -500,
      writeOffKopecks: 0,
      resultKopecks: direct.resultKopecks,
      unknownCount: 0,
    });
    expect(direct.resultKopecks).toBe(-5_000 - 6_000 - 6_000 - 1_000 + 2_000 - 500);
  });

  it('упаковка — только расходы заказа, не доли по товару', () => {
    expect(repackingSharesOf(ymReturn).map((e) => e.id)).toEqual(['e1']);
  });

  it('площадки отдельно: Ozon не попадает в число ЯМ', () => {
    expect(ozon).toMatchObject({
      ordersCount: 1,
      returnedCount: 1,
      returnRate: 1,
      reverseKopecks: -7_000,
      resultKopecks: -7_000,
    });
    expect(summary.orders.map((o) => o.orderId)).toEqual(['100', 'O-1']);
  });

  it('модели — по вернувшимся штукам, доля от ушедших', () => {
    expect(summary.models).toEqual([
      expect.objectContaining({
        marketplace: 'ym',
        offerId: 'A1',
        returnedUnits: 1,
        soldUnits: 2,
        returnRate: 0.5,
      }),
      expect.objectContaining({ marketplace: 'ozon', offerId: 'OZ', returnedUnits: 1 }),
    ]);
    expect(RETURNS_TOP_MODELS).toBe(10);
  });

  it('неизвестная себестоимость списания → итог площадки null, не 0', () => {
    const damaged = order([returned({ orderId: '200' })], [], {
      lotCostOf: (): TLotSaleCost =>
        ({
          status: 'unknown',
          reason: 'no-lot',
          returned: { restored: false, condition: 'damaged' },
        }) as never,
    });
    const result = returnsSummaryOf([damaged], ['ym']).marketplaces[0];
    expect(result.resultKopecks).toBeNull();
    expect(result.writeOffKopecks).toBeNull();
    expect(result.unknownCount).toBe(1);
  });

  it('позиция без выручки → стоимость возвращённого null', () => {
    const noValue = order([returned({ orderId: '300', revenueKopecks: null })]);
    expect(returnsSummaryOf([noValue], ['ym']).marketplaces[0].returnedValueKopecks).toBeNull();
  });
});

describe('AccountingReturnsService', () => {
  const MONTH = { from: '2026-10-01', to: '2026-10-31' };

  it('ЯМ без магазина не показывается; карточки — месяца оформления', async () => {
    const periodOrders = vi.fn(async () => [ymReturn, ozonReturn]);
    const service = new AccountingReturnsService(
      { marketplacesOf: async () => ['ym', 'ozon'] } as never,
      { periodOrders } as never,
    );
    const noStore = await service.month('u1', {}, null, MONTH);
    expect(noStore.marketplaces.map((m) => m.marketplace)).toEqual(['ozon']);
    expect(noStore.period).toEqual(MONTH);
    expect(periodOrders).toHaveBeenCalledWith('u1', {}, null, MONTH, {}, expect.any(Date));

    const withStore = await service.month('u1', {}, { campaign_id: 11 } as never, MONTH);
    expect(withStore.marketplaces.map((m) => m.marketplace)).toEqual(['ym', 'ozon']);
  });
});

describe('CrmAccountingKinds — возвраты', () => {
  const context = (params: Record<string, unknown>): ICrmJobContext => ({
    jobId: 'j1',
    telegramUserId: 'u1',
    store: null,
    params,
    features: {},
  });

  it('kind под зонтиком и подфичей возвратов', () => {
    const register = vi.fn();
    new CrmAccountingKinds(
      { register } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    ).onModuleInit();
    const call = register.mock.calls.find(([kind]) => kind === ACCOUNTING_RETURNS_KIND);
    expect(call?.[1].features).toEqual(['fin_accounting', 'fin_accounting_returns']);
  });

  it('мусорный месяц — CrmJobError с текстом; верный — сервис', async () => {
    const month = vi.fn(async () => ({ period: {}, marketplaces: [], models: [], orders: [] }));
    const kinds = new CrmAccountingKinds(
      { register: vi.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      { month } as never,
      {} as never,
    );
    await expect(kinds.returns(context({ month: '2026-13' }))).rejects.toThrow(CrmJobError);
    await expect(kinds.returns(context({}))).rejects.toThrow(ACCOUNTING_RETURNS_BAD_MONTH_TEXT);
    await kinds.returns(context({ month: '2026-10' }));
    expect(month).toHaveBeenCalledWith(
      'u1',
      {},
      null,
      { from: '2026-10-01', to: '2026-10-31' },
      expect.any(Date),
    );
  });
});
