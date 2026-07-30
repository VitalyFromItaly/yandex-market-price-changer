import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import {
  MENU_TO_REPORT,
  ReportsHandler,
} from '../../src/modules/telegram/bots/price-changer-bot/handlers/reports.handler';
import { OrderReportsService } from '../../src/modules/yandex/reports/order-reports.service';
import { ProfitService } from '../../src/modules/yandex/reports/profit.service';
import { YandexMarketService } from '../../src/database/services/yandex-market.service';
import { REPORT } from '../../src/modules/yandex/reports/report-status-map';
import {
  MENU,
  MENU_LABELS,
} from '../../src/modules/telegram/bots/price-changer-bot/menu.constants';
import { YandexAuthError, YandexRateLimitError } from '../../src/modules/yandex/yandex-api.errors';
import { UserAccessService } from '../../src/database/services/user-access.service';
import { PriceChangerKeyboard } from '../../src/modules/telegram/bots/price-changer-bot/price-changer.keyboard';
import { DEFAULT_PERIOD } from '../../src/modules/yandex/reports/report-period';

const STORE = { token: 'ACMA:x', campaign_id: '1', business_id: '2' };

async function build(
  opts: { store?: unknown; build?: () => Promise<unknown>; profit?: () => Promise<unknown> } = {},
) {
  const reports = {
    build: vi.fn(
      opts.build ??
        (async () => ({
          key: REPORT.REDEEMED,
          title: 'Выкуплено',
          count: 1,
          totals: { items: 100, withDelivery: 120 },
          orders: [],
        })),
    ),
    exportInTransit: vi.fn(async () => ({ empty: true, message: 'нет данных' })),
  };
  const yandexMarketService = {
    findByTelegramUser: vi.fn(async () => ('store' in opts ? opts.store : STORE)),
  };

  const access = {
    setPendingReportDay: vi.fn(async () => null),
    findByUserAndBot: vi.fn(async () => null),
  };

  const profit = {
    build: vi.fn(
      opts.profit ??
        (async () => ({
          period: DEFAULT_PERIOD,
          pricesUpdatedAt: new Date('2026-07-29T10:00:00Z'),
          totals: {
            revenue: 10000,
            commission: 2300,
            tax: 700,
            purchase: 5000,
            net: 2000,
            orders: 1,
            excludedOrders: 0,
            excludedRevenue: 0,
            unknownSkus: [],
            returnedOrders: 0,
            returnedRevenue: 0,
            rates: {
              commissionPercent: 23,
              taxPercent: 7,
              discountPercent: 10,
              vostokDiscountPercent: 4,
            },
          },
        })),
    ),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      ReportsHandler,
      PriceChangerKeyboard,
      { provide: OrderReportsService, useValue: reports },
      { provide: ProfitService, useValue: profit },
      { provide: YandexMarketService, useValue: yandexMarketService },
      { provide: UserAccessService, useValue: access },
    ],
  }).compile();

  return { handler: moduleRef.get(ReportsHandler), reports, access, profit };
}

function fakeCtx() {
  return {
    from: { id: 222 },
    botInfo: { id: 999 },
    reply: vi.fn(async () => undefined),
    replyWithDocument: vi.fn(async () => undefined),
    texts(): string[] {
      return this.reply.mock.calls.map((c: unknown[]) => String(c[0]));
    },
  };
}

describe('Кнопки отчётов', () => {
  it('каждая кнопка отчёта ведёт к своему отчёту', () => {
    expect(MENU_TO_REPORT[MENU.SHIPPED_TODAY]).toBe(REPORT.SHIPPED_TODAY);
    expect(MENU_TO_REPORT[MENU.REDEEMED]).toBe(REPORT.REDEEMED);
    expect(MENU_TO_REPORT[MENU.RETURNING]).toBe(REPORT.RETURNING);
    expect(MENU_TO_REPORT[MENU.IN_TRANSIT]).toBe(REPORT.IN_TRANSIT);
    expect(MENU_TO_REPORT[MENU.PROFIT]).toBe(REPORT.PROFIT);
  });

  it('все метки отчётов есть в справочнике меню', () => {
    for (const label of Object.keys(MENU_TO_REPORT)) {
      expect(MENU_LABELS).toContain(label);
    }
  });
});

describe('ReportsHandler', () => {
  it('показывает индикацию до начала сбора', async () => {
    // Обход страниц занимает секунды; молчащий бот неотличим от сломанного.
    const { handler } = await build();
    const ctx = fakeCtx();

    await handler.run(ctx as never, REPORT.REDEEMED, DEFAULT_PERIOD);

    expect(ctx.texts()[0]).toContain('Собираю');
  });

  it('повторное нажатие во время сбора НЕ запускает второй запрос', async () => {
    // Каждое нажатие — полный обход страниц, который жжёт часовую квоту.
    let release: () => void;
    const { handler, reports } = await build({
      build: () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              key: REPORT.REDEEMED,
              title: 'x',
              count: 0,
              totals: { items: 0, withDelivery: 0 },
              orders: [],
            });
        }),
    });
    const ctx = fakeCtx();

    const first = handler.run(ctx as never, REPORT.REDEEMED, DEFAULT_PERIOD);
    await handler.run(ctx as never, REPORT.REDEEMED, DEFAULT_PERIOD);

    expect(reports.build).toHaveBeenCalledTimes(1);
    expect(ctx.texts().some((t) => t.includes('уже собирается'))).toBe(true);

    release!();
    await first;
  });

  it('после завершения защёлка снимается', async () => {
    const { handler, reports } = await build();
    const ctx = fakeCtx();

    await handler.run(ctx as never, REPORT.REDEEMED, DEFAULT_PERIOD);
    await handler.run(ctx as never, REPORT.REDEEMED, DEFAULT_PERIOD);

    expect(reports.build).toHaveBeenCalledTimes(2);
  });

  it('ОШИБКА тоже снимает защёлку — иначе отчёты запираются до рестарта', async () => {
    const { handler, reports } = await build({
      build: async () => {
        throw new YandexRateLimitError('quota', 420);
      },
    });
    const ctx = fakeCtx();

    await handler.run(ctx as never, REPORT.REDEEMED, DEFAULT_PERIOD);
    await handler.run(ctx as never, REPORT.REDEEMED, DEFAULT_PERIOD);

    expect(reports.build).toHaveBeenCalledTimes(2);
  });

  it('доменная ошибка показывается понятным текстом, а не молчанием', async () => {
    const { handler } = await build({
      build: async () => {
        throw new YandexAuthError('unauthorized', 401);
      },
    });
    const ctx = fakeCtx();

    await handler.run(ctx as never, REPORT.REDEEMED, DEFAULT_PERIOD);

    const last = ctx.texts().at(-1)!;
    expect(last).toContain('токен');
    expect(last).not.toContain('401');
  });

  it('неизвестная ошибка не показывает внутренности', async () => {
    const { handler } = await build({
      build: async () => {
        throw new Error('connect ECONNREFUSED 10.0.0.1:5432');
      },
    });
    const ctx = fakeCtx();

    await handler.run(ctx as never, REPORT.REDEEMED, DEFAULT_PERIOD);

    const last = ctx.texts().at(-1)!;
    expect(last).toContain('Попробуйте позже');
    expect(last).not.toContain('ECONNREFUSED');
  });

  it('без настроек API отчёт не запрашивается', async () => {
    const { handler, reports } = await build({ store: null });
    const ctx = fakeCtx();

    await handler.run(ctx as never, REPORT.REDEEMED, DEFAULT_PERIOD);

    expect(reports.build).not.toHaveBeenCalled();
    expect(ctx.texts().at(-1)).toContain('настройки API');
  });

  it('пустая выгрузка отправляет сообщение, а не документ', async () => {
    const { handler } = await build();
    const ctx = fakeCtx();

    await handler.handle(ctx as never, REPORT.IN_TRANSIT);

    expect(ctx.replyWithDocument).not.toHaveBeenCalled();
    expect(ctx.texts().at(-1)).toContain('нет данных');
  });
});

describe('Прибыль', () => {
  it('идёт в ProfitService, а не в обычный отчёт', async () => {
    const { handler, reports, profit } = await build();
    const ctx = fakeCtx();

    await handler.run(ctx as never, REPORT.PROFIT, DEFAULT_PERIOD);

    expect(profit.build).toHaveBeenCalledTimes(1);
    // Заказы ProfitService берёт сам; напрямую отсюда обычный отчёт не строится.
    expect(reports.build).not.toHaveBeenCalled();
  });

  it('в тексте видны все вычитания и чистая', async () => {
    const { handler } = await build();
    const ctx = fakeCtx();

    await handler.run(ctx as never, REPORT.PROFIT, DEFAULT_PERIOD);

    const text = ctx.texts().at(-1)!;
    expect(text).toContain('Продажи');
    expect(text).toContain('Комиссия 23%');
    expect(text).toContain('Налог 7%');
    expect(text).toContain('Закуп');
    expect(text).toContain('Чистая');
  });

  it('кнопка «Прибыль» сначала спрашивает период', async () => {
    const { handler, profit } = await build();
    const ctx = fakeCtx();

    await handler.handle(ctx as never, REPORT.PROFIT);

    expect(profit.build).not.toHaveBeenCalled();
    expect(ctx.texts().at(-1)).toContain('за какой период');
  });

  it('выбранный период доезжает до расчёта прибыли', async () => {
    const { handler, profit } = await build();
    const ctx = fakeCtx();

    await handler.run(ctx as never, REPORT.PROFIT, { key: 'month' } as never);

    expect(profit.build).toHaveBeenCalledWith(expect.anything(), { key: 'month' });
  });

  it('без настроек API прибыль не считается', async () => {
    const { handler, profit } = await build({ store: null });
    const ctx = fakeCtx();

    await handler.run(ctx as never, REPORT.PROFIT, DEFAULT_PERIOD);

    expect(profit.build).not.toHaveBeenCalled();
    expect(ctx.texts().at(-1)).toContain('настройки API');
  });
});

describe('Выбор периода', () => {
  it('нажатие на отчёт сначала спрашивает период, а не идёт в Яндекс', async () => {
    const { handler, reports } = await build();
    const ctx = fakeCtx();

    await handler.handle(ctx as never, REPORT.REDEEMED);

    expect(reports.build).not.toHaveBeenCalled();
    expect(ctx.texts().at(-1)).toContain('за какой период');
  });

  it('«Едет до клиента» период НЕ спрашивает', async () => {
    // Это срез «что сейчас в пути» (dateFilter: 'none'): период на него не
    // влияет, и кнопка выбора была бы кнопкой, которая ничего не меняет.
    const { handler } = await build();
    const ctx = fakeCtx();

    await handler.handle(ctx as never, REPORT.IN_TRANSIT);

    expect(ctx.texts().some((t) => t.includes('за какой период'))).toBe(false);
  });

  it('выбранный период доезжает до сервиса отчётов', async () => {
    const { handler, reports } = await build();
    const ctx = fakeCtx();

    await handler.run(ctx as never, REPORT.REDEEMED, { key: 'month' } as never);

    expect(reports.build).toHaveBeenCalledWith(
      expect.anything(),
      REPORT.REDEEMED,
      expect.any(Date),
      { key: 'month' },
    );
  });

  it('нераспознанная дата переспрашивает, не закрывая вопрос', async () => {
    const { handler, access } = await build();
    access.findByUserAndBot = vi.fn(async () => ({ pendingReportDay: REPORT.REDEEMED })) as never;
    const ctx = fakeCtx();

    const handled = await handler.handlePendingDay(ctx as never, 'позавчера');

    expect(handled).toBe(true);
    expect(ctx.texts().at(-1)).toContain('Не понял дату');
    // Вопрос остаётся открытым — иначе пользователь начинал бы заново.
    expect(access.setPendingReportDay).not.toHaveBeenCalled();
  });

  it('без незакрытого вопроса текст не перехватывается', async () => {
    // Иначе обработчик съедал бы обычные сообщения — например токен.
    const { handler } = await build();
    const ctx = fakeCtx();

    expect(await handler.handlePendingDay(ctx as never, '28-07-2026')).toBe(false);
  });
});
