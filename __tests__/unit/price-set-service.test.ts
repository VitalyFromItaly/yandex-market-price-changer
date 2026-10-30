import { describe, it, expect, vi } from 'vitest';

import type {
  IPriceSetCurrent,
  IPriceSetRequest,
} from '../../src/modules/price-set/price-set.domain';
import type { TMarketplace } from '../../src/shared/marketplace';

import { REQUIRE_FEATURE } from '../../src/modules/crm/crm-auth.decorators';
import { CRM_SECTIONS } from '../../src/modules/crm/crm-features.domain';
import { CrmPriceSetController } from '../../src/modules/crm/price-set/crm-price-set.controller';
import {
  PRICE_SET_KIND,
  parseExcluded,
  parseMarketplaces,
  parseMarkups,
  toCrmPriceSet,
} from '../../src/modules/crm/price-set/crm-price-set.domain';
import { CrmPriceSetKinds } from '../../src/modules/crm/price-set/crm-price-set.kinds';
import { CrmJobError } from '../../src/modules/crm/jobs/crm-jobs.domain';
import { MarketplaceNotConnectedError } from '../../src/modules/marketplaces/marketplace-adapter';
import {
  priceSetRequestOf,
  priceSetRowKey,
  priceSetSkusOf,
} from '../../src/modules/price-set/price-set.domain';
import {
  PRICE_SET_LOG_KIND,
  PRICE_SET_WRITE_FEATURE,
  PriceSetMarkupClosedError,
  PriceSetPlanChangedError,
  PriceSetService,
} from '../../src/modules/price-set/price-set.service';
import { FEATURE, FEATURE_META } from '../../src/modules/telegram/bots/shared/features.domain';
import { StockSyncProcessor } from '../../src/modules/telegram/queue/processors/stock-sync.processor';

/**
 * «Установка цен» (TASK-202): PriceSetService (plan/apply) и доставка в CRM.
 * План только читает; запись — по отпечатку, площадки независимы.
 */

const PLAN_ID = '11111111-2222-3333-4444-555555555555';

const ALL_WRITE = {
  [FEATURE.PRICE_SET]: true,
  [FEATURE.PURCHASE_PRICES]: true,
  [FEATURE.OZON]: true,
  [FEATURE.WB]: true,
  [FEATURE.PRICE_SET_WRITE_YM]: true,
  [FEATURE.PRICE_SET_WRITE_OZON]: true,
  [FEATURE.PRICE_SET_WRITE_WB]: true,
};

const CATALOG = [
  {
    id: 'p1',
    internalSku: 'A-1',
    name: 'Часы A',
    marketplaceSkus: { ym: 'A-1', ozon: 'OZ-A', wb: 'WB-A' },
    purchase: { price: 1000 },
  },
  {
    id: 'p2',
    internalSku: 'B-2',
    name: 'Часы B',
    marketplaceSkus: { ym: 'B-2' },
    purchase: null,
  },
];

const MARKUP: IPriceSetRequest = {
  desired: { source: 'markup', percents: { ym: 250, ozon: 300, wb: 250 } },
  marketplaces: ['ym', 'ozon', 'wb'],
};

type TCurrent = Partial<Record<TMarketplace, Record<string, IPriceSetCurrent> | Error>>;

function priceService(
  current: TCurrent = {},
  writeFails: Partial<Record<TMarketplace, Error>> = {},
) {
  const prices: TCurrent = {
    ym: { 'A-1': { price: 2000 }, 'B-2': { price: 900 } },
    ozon: { 'OZ-A': { price: 2900 } },
    wb: { 'WB-A': { price: 5000, discount: 50 } },
    ...current,
  };
  const currentPrices = vi.fn(async (ref: { marketplace: TMarketplace }, _skus: string[]) => {
    const value = prices[ref.marketplace];
    if (value instanceof Error) throw value;
    return new Map(Object.entries(value ?? {}));
  });
  const writePrices = vi.fn(
    async (ref: { marketplace: TMarketplace }, updates: { sku: string; price: number }[]) => {
      const fail = writeFails[ref.marketplace];
      if (fail) throw fail;
      return { written: updates.length, errors: [], skipped: [] };
    },
  );
  const writer = { currentPrices, writePrices };
  const registry = {
    capability: vi.fn(() => writer),
    require: vi.fn(() => writer),
  };
  const record = vi.fn(async () => undefined);
  const report = vi.fn(async () => undefined);
  const service = new PriceSetService(
    registry as never,
    { listForCatalog: vi.fn(async () => CATALOG) } as never,
    { lastUpdatedAt: vi.fn(async () => new Date('2026-10-29T10:00:00Z')) } as never,
    { record } as never,
    { report } as never,
  );
  return { service, currentPrices, writePrices, record, report, registry };
}

describe('фича и раздел', () => {
  it('все фичи выключены по умолчанию, запись требует плана (и площадки)', () => {
    expect(FEATURE_META[FEATURE.PRICE_SET].defaultEnabled).toBe(false);
    expect(FEATURE_META[FEATURE.PRICE_SET_WRITE_YM]).toMatchObject({
      defaultEnabled: false,
      requires: [FEATURE.PRICE_SET],
    });
    expect(FEATURE_META[FEATURE.PRICE_SET_WRITE_OZON]).toMatchObject({
      defaultEnabled: false,
      requires: [FEATURE.PRICE_SET, FEATURE.OZON],
    });
    expect(FEATURE_META[FEATURE.PRICE_SET_WRITE_WB]).toMatchObject({
      defaultEnabled: false,
      requires: [FEATURE.PRICE_SET, FEATURE.WB],
    });
    expect(PRICE_SET_WRITE_FEATURE).toEqual({
      ym: FEATURE.PRICE_SET_WRITE_YM,
      ozon: FEATURE.PRICE_SET_WRITE_OZON,
      wb: FEATURE.PRICE_SET_WRITE_WB,
    });
    expect(CRM_SECTIONS['ym-price-set']).toEqual([FEATURE.PRICE_SET]);
  });

  it('kind плана — аккаунта под price_set, маршруты — под price_set', () => {
    expect(Reflect.getMetadata(REQUIRE_FEATURE, CrmPriceSetController)).toEqual([
      FEATURE.PRICE_SET,
    ]);
    const register = vi.fn();
    new CrmPriceSetKinds({ register } as never, {} as never, {} as never).onModuleInit();
    expect(register).toHaveBeenCalledWith(
      PRICE_SET_KIND,
      expect.objectContaining({ features: [FEATURE.PRICE_SET], scope: 'account' }),
    );
  });
});

describe('PriceSetService.plan — только чтение', () => {
  it('наценка: закуп × %, WB — базовая под скидку; запись не зовётся', async () => {
    const { service, writePrices, currentPrices } = priceService();
    const result = await service.plan('1', ALL_WRITE, MARKUP);

    expect(writePrices).not.toHaveBeenCalled();
    const [ym, ozon, wb] = result.plan.targets;
    expect(ym.updates).toEqual([expect.objectContaining({ mpSku: 'A-1', from: 2000, to: 2500 })]);
    // B-2 без закупа — «нет закупа», а не цена 0.
    expect(ym.skipped).toEqual([expect.objectContaining({ sku: 'B-2', reason: 'no-purchase' })]);
    expect(ozon.updates[0]).toMatchObject({ mpSku: 'OZ-A', from: 2900, to: 3000 });
    // WB: покупатель видит 2500 (5000 −50%), хотим 2500 → без изменений.
    expect(wb.unchanged).toBe(1);
    expect(result.priceListAt).toBe('2026-10-29T10:00:00.000Z');
    // Спрашиваются только артикулы площадки, а не весь справочник.
    expect(currentPrices).toHaveBeenCalledWith({ telegramUserId: '1', marketplace: 'ozon' }, [
      'OZ-A',
    ]);
  });

  it('наценка при закрытом «Закупе из прайса» — отказ до чтения площадок', async () => {
    const { service, currentPrices } = priceService();
    await expect(
      service.plan('1', { ...ALL_WRITE, [FEATURE.PURCHASE_PRICES]: false }, MARKUP),
    ).rejects.toBeInstanceOf(PriceSetMarkupClosedError);
    expect(currentPrices).not.toHaveBeenCalled();
  });

  it('цены одной площадки не прочитались — блок только её, причина текстом', async () => {
    const failure = Object.assign(new Error('403'), { userMessage: 'нет права «Цены и скидки»' });
    const { service, report } = priceService({ wb: failure });
    const result = await service.plan('1', ALL_WRITE, MARKUP);

    expect(result.plan.targets.map((t) => t.blockedBy)).toEqual([null, null, 'read-error']);
    expect(result.readErrors.wb).toBe('нет права «Цены и скидки»');
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ context: 'price-set:read:wb' }));
  });

  it('не подключена или закрыта фичей — не спрашивается, а названа', async () => {
    const { service } = priceService({
      ozon: new MarketplaceNotConnectedError('ozon', '1', 'no-credentials'),
    });
    const result = await service.plan('1', { ...ALL_WRITE, [FEATURE.WB]: false }, MARKUP);
    expect(result.plan.targets.map((t) => t.marketplace)).toEqual(['ym']);
    expect(result.notConsidered).toEqual([
      { marketplace: 'ozon', reason: 'площадка не подключена' },
      { marketplace: 'wb', reason: 'функция площадки закрыта' },
    ]);
  });

  it('закрытая запись площадки — просмотр: строки есть, но вне отпечатка', async () => {
    const { service } = priceService();
    const result = await service.plan(
      '1',
      { ...ALL_WRITE, [FEATURE.PRICE_SET_WRITE_OZON]: false },
      MARKUP,
    );
    const ozon = result.plan.targets[1];
    expect(ozon.blockedBy).toBe('no-write-method');
    expect(ozon.updates).toHaveLength(1);
  });
});

describe('PriceSetService.apply — запись по отпечатку', () => {
  it('отпечаток не совпал — ни одной записи', async () => {
    const { service, writePrices } = priceService();
    await expect(service.apply('1', ALL_WRITE, MARKUP, 'f'.repeat(64))).rejects.toBeInstanceOf(
      PriceSetPlanChangedError,
    );
    expect(writePrices).not.toHaveBeenCalled();
  });

  it('закрытая запись — отказ и в сервисе, не только в гварде', async () => {
    const { service } = priceService();
    await expect(
      service.apply(
        '1',
        { [FEATURE.PRICE_SET]: true, [FEATURE.PURCHASE_PRICES]: true },
        MARKUP,
        'h',
      ),
    ).rejects.toThrow(/запись закрыта/);
  });

  it('падение Ozon не отменяет ЯМ; снятые строки не уходят; журнал по площадке', async () => {
    const { service: probe } = priceService({}, {});
    const { plan } = await probe.plan('1', ALL_WRITE, {
      ...MARKUP,
      desired: { source: 'markup', percents: { ym: 250, ozon: 300, wb: 300 } },
    });
    const request: IPriceSetRequest = {
      ...MARKUP,
      desired: { source: 'markup', percents: { ym: 250, ozon: 300, wb: 300 } },
    };
    const { service, writePrices, record, report } = priceService(
      {},
      { ozon: new Error('Ozon 500') },
    );
    const result = await service.apply('1', ALL_WRITE, request, plan.planHash, undefined, [
      priceSetRowKey('wb', 'WB-A'),
    ]);

    expect(writePrices).toHaveBeenCalledTimes(2);
    expect(writePrices).toHaveBeenCalledWith({ telegramUserId: '1', marketplace: 'ym' }, [
      { sku: 'A-1', price: 2500 },
    ]);
    expect(result.writes.map((w) => [w.marketplace, w.written, w.errors.length])).toEqual([
      ['ym', 1, 0],
      ['ozon', 0, 1],
    ]);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ context: 'price-set:write' }));
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: PRICE_SET_LOG_KIND, status: 'ok', context: 'price-set:ym' }),
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: PRICE_SET_LOG_KIND,
        status: 'error',
        context: 'price-set:ozon',
      }),
    );
  });

  it('выбор площадок сужает запись, отпечаток — по всему плану', async () => {
    const { service } = priceService();
    const { plan } = await service.plan('1', ALL_WRITE, MARKUP);
    const result = await service.apply('1', ALL_WRITE, MARKUP, plan.planHash, ['ozon']);
    expect(result.writes.map((w) => w.marketplace)).toEqual(['ozon']);
  });

  it('файл: тот же сопоставитель артикулов, что у плана', async () => {
    const { service, writePrices } = priceService();
    const request: IPriceSetRequest = {
      desired: { source: 'file', rows: [{ sku: 'A-1', price: 3100.4 }] },
      marketplaces: ['ozon'],
    };
    expect(priceSetSkusOf([], request.desired, 'ozon')).toEqual(['A-1']);
    const { plan } = await service.plan('1', ALL_WRITE, request);
    await service.apply('1', ALL_WRITE, request, plan.planHash);
    expect(writePrices).toHaveBeenCalledWith({ telegramUserId: '1', marketplace: 'ozon' }, [
      { sku: 'OZ-A', price: 3100 },
    ]);
  });
});

describe('CRM: разбор входа и вид', () => {
  it('наценка: только числа в границах, площадки — из ключей', () => {
    expect(parseMarkups({ ym: 250, ozon: '' })).toEqual({
      desired: { source: 'markup', percents: { ym: 250 } },
      marketplaces: ['ym'],
    });
    expect(parseMarkups({ ym: 0 })).toBeNull();
    expect(parseMarkups({ avito: 200 })).toBeNull();
    expect(parseMarkups({})).toBeNull();
    expect(parseMarketplaces('ozon,ym')).toEqual(['ym', 'ozon']);
    expect(parseMarketplaces('["wb"]')).toEqual(['wb']);
    expect(parseMarketplaces('')).toBeNull();
    expect(parseExcluded(undefined)).toEqual([]);
    expect(parseExcluded('ym:A')).toBeNull();
  });

  it('запрос плана в хранилище — только целой формы', () => {
    expect(priceSetRequestOf(MARKUP)).toEqual(MARKUP);
    expect(priceSetRequestOf({ ...MARKUP, marketplaces: ['avito'] })).toBeNull();
    expect(
      priceSetRequestOf({
        desired: { source: 'file', rows: [{ sku: 'A', price: '1' }] },
        marketplaces: [],
      }),
    ).toBeNull();
  });

  it('вид: risky не входят в writeCount, закрытая площадка не пишется', async () => {
    const { service } = priceService({ ym: { 'A-1': { price: 100 }, 'B-2': { price: 900 } } });
    const result = await service.plan('1', ALL_WRITE, MARKUP);
    const view = toCrmPriceSet(result, {
      now: new Date('2026-10-30T00:00:00Z'),
      writeOpen: { ym: true, ozon: false, wb: true },
    });
    // ЯМ 100 → 2500 — рискованная; Ozon закрыт.
    expect(view.targets[0].updates[0]).toMatchObject({
      key: 'ym:A-1',
      risky: true,
      deltaPct: 2400,
    });
    expect(view.targets.map((t) => t.willWrite)).toEqual([true, false, false]);
    expect(view.writeCount).toBe(0);
    expect(view.request).toEqual(MARKUP);
  });
});

describe('CRM: kind плана', () => {
  function kinds(readInput = vi.fn(async () => null)) {
    const { service } = priceService();
    return new CrmPriceSetKinds({ register: vi.fn() } as never, service, { readInput } as never);
  }
  const context = (params: Record<string, unknown>, features = ALL_WRITE) =>
    ({ jobId: PLAN_ID, telegramUserId: '1', store: null, params, features }) as never;

  it('наценка из params; плохая — отказ текстом, не сбой', async () => {
    const output = await kinds().plan(context({ markups: { ym: 250 } }));
    expect((output.data as { targets: unknown[] }).targets).toHaveLength(1);
    await expect(kinds().plan(context({ markups: { ym: -1 } }))).rejects.toBeInstanceOf(
      CrmJobError,
    );
    await expect(
      kinds().plan(
        context({ markups: { ym: 250 } }, { ...ALL_WRITE, [FEATURE.PURCHASE_PRICES]: false }),
      ),
    ).rejects.toBeInstanceOf(CrmJobError);
  });

  it('файл: читается из входа задачи, битые строки — в виде', async () => {
    const csv = Buffer.from('Артикул;Цена\nA-1;3000\nB-2;абв\n', 'utf8');
    const readInput = vi.fn(async () => ({ buffer: csv, filename: 'prices.csv' }));
    const output = await kinds(readInput).plan(context({ source: 'file', marketplaces: ['ym'] }));
    expect(readInput).toHaveBeenCalledWith(PLAN_ID);
    const data = output.data as { fileBad: { row: number }[]; request: IPriceSetRequest };
    expect(data.fileBad).toEqual([expect.objectContaining({ row: 3 })]);
    expect(data.request.desired).toEqual({ source: 'file', rows: [{ sku: 'A-1', price: 3000 }] });
    await expect(
      kinds().plan(context({ source: 'file', marketplaces: ['ym'] })),
    ).rejects.toBeInstanceOf(CrmJobError);
  });
});

describe('CRM: маршруты', () => {
  function controller(over: { findOwn?: unknown; claimCreated?: boolean } = {}) {
    const writeQueue = { add: vi.fn(async () => undefined) };
    const planQueue = { add: vi.fn(async () => undefined) };
    const results = {
      claim: vi.fn(async (input: { jobId: string }) => ({
        jobId: input.jobId,
        created: over.claimCreated ?? true,
      })),
      findOwn: vi.fn(async () =>
        'findOwn' in over
          ? over.findOwn
          : { kind: PRICE_SET_KIND, status: 'done', data: { request: MARKUP } },
      ),
      finishFailed: vi.fn(async () => undefined),
    };
    return {
      controller: new CrmPriceSetController(
        writeQueue as never,
        planQueue as never,
        results as never,
      ),
      writeQueue,
      planQueue,
      results,
    };
  }
  const user = (features: Record<string, boolean>) =>
    ({ crmUser: { telegramUserId: '1', features } }) as never;
  const body = { planJobId: PLAN_ID, planHash: 'a'.repeat(64) };

  it('apply: закрытая запись — 403, ничего не заявлено', async () => {
    const { controller: c, results } = controller();
    await expect(c.apply(user({ [FEATURE.PRICE_SET]: true }), body)).rejects.toMatchObject({
      status: 403,
    });
    expect(results.claim).not.toHaveBeenCalled();
  });

  it('apply: нет плана, чужой или не тот kind — 400', async () => {
    for (const findOwn of [null, { kind: 'stock-push:plan', status: 'done', data: {} }]) {
      const { controller: c, results } = controller({ findOwn });
      await expect(c.apply(user(ALL_WRITE), body)).rejects.toMatchObject({ status: 400 });
      expect(results.claim).not.toHaveBeenCalled();
    }
    const { controller: c } = controller();
    await expect(c.apply(user(ALL_WRITE), { ...body, planHash: 'x' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(c.apply(user(ALL_WRITE), { ...body, marketplaces: [] })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('apply: payload без токена, attempts: 1; повтор — 409 PRICE_SET_RUNNING', async () => {
    const { controller: c, writeQueue } = controller();
    const { jobId } = await c.apply(user(ALL_WRITE), { ...body, excluded: ['ym:A-1'] });
    expect(writeQueue.add).toHaveBeenCalledWith(
      'sync-stocks',
      {
        source: 'price-set',
        jobId,
        telegramUserId: '1',
        planJobId: PLAN_ID,
        planHash: 'a'.repeat(64),
        features: ALL_WRITE,
        excluded: ['ym:A-1'],
      },
      { attempts: 1, jobId },
    );

    const busy = controller({ claimCreated: false });
    await expect(busy.controller.apply(user(ALL_WRITE), body)).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: 'PRICE_SET_RUNNING' }),
    });
    expect(busy.writeQueue.add).not.toHaveBeenCalled();
  });

  it('upload: csv — в crm-jobs с файлом во входе; не тот формат — 400', async () => {
    const { controller: c, planQueue, results } = controller();
    const file = { originalname: 'prices.csv', size: 10, buffer: Buffer.from('A;1') };
    const { jobId } = await c.upload(user(ALL_WRITE), file, { marketplaces: 'ym,wb' });
    expect(results.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: PRICE_SET_KIND,
        params: { source: 'file', fileName: 'prices.csv', marketplaces: ['ym', 'wb'] },
        input: { buffer: file.buffer, filename: 'prices.csv' },
      }),
    );
    expect(planQueue.add).toHaveBeenCalledWith(
      'run-crm-job',
      expect.objectContaining({ jobId, kind: PRICE_SET_KIND }),
      { jobId },
    );

    const bad = controller();
    await expect(
      bad.controller.upload(
        user(ALL_WRITE),
        { ...file, originalname: 'prices.pdf' },
        { marketplaces: 'ym' },
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(bad.controller.upload(user(ALL_WRITE), file, {})).rejects.toMatchObject({
      status: 400,
    });
    await expect(bad.controller.upload(user(ALL_WRITE), undefined, {})).rejects.toMatchObject({
      status: 400,
    });
    expect(bad.results.claim).not.toHaveBeenCalled();
  });
});

describe('StockSyncProcessor — запись цен', () => {
  function processorWith(
    apply: ReturnType<typeof vi.fn>,
    plan: unknown = { data: { request: MARKUP } },
  ) {
    const crmJobs = {
      markActive: vi.fn(async () => undefined),
      findOwn: vi.fn(async () => plan),
      finishDone: vi.fn(async () => undefined),
      finishFailed: vi.fn(async () => undefined),
    };
    const report = vi.fn();
    const processor = new StockSyncProcessor(
      {} as never,
      {} as never,
      {} as never,
      { report } as never,
      crmJobs as never,
      {} as never,
      {} as never,
      { record: vi.fn() } as never,
      { apply } as never,
    );
    return { processor, crmJobs, report };
  }
  const job = {
    id: 'j',
    name: 'sync-stocks',
    data: {
      source: 'price-set',
      jobId: 'j',
      telegramUserId: '1',
      planJobId: PLAN_ID,
      planHash: 'h',
      features: ALL_WRITE,
      excluded: ['ym:A-1'],
    },
  } as never;

  it('запрос — из плана по planJobId, итог — в CrmJobResult', async () => {
    const apply = vi.fn(async () => ({ writes: [{ marketplace: 'ym', written: 1 }] }));
    const { processor, crmJobs } = processorWith(apply);
    await processor.run(job);
    expect(crmJobs.findOwn).toHaveBeenCalledWith(PLAN_ID, '1');
    expect(apply).toHaveBeenCalledWith('1', ALL_WRITE, MARKUP, 'h', undefined, ['ym:A-1']);
    expect(crmJobs.finishDone).toHaveBeenCalledWith(
      'j',
      { writes: [{ marketplace: 'ym', written: 1 }] },
      null,
    );
  });

  it('план изменился — failed с текстом продавцу, админов не будим', async () => {
    const { processor, crmJobs, report } = processorWith(
      vi.fn(async () => {
        throw new PriceSetPlanChangedError();
      }),
    );
    await processor.run(job);
    expect(crmJobs.finishFailed).toHaveBeenCalledWith(
      'j',
      expect.stringMatching(/Цены изменились/),
    );
    expect(report).not.toHaveBeenCalled();
  });

  it('план истёк — failed без записи', async () => {
    const apply = vi.fn();
    const { processor, crmJobs } = processorWith(apply, null);
    await processor.run(job);
    expect(apply).not.toHaveBeenCalled();
    expect(crmJobs.finishFailed).toHaveBeenCalledWith('j', expect.stringMatching(/устарел/));
  });
});
