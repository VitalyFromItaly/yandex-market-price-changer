import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import {
  MENU_TO_REPORT,
  ReportsHandler,
} from '../../src/modules/telegram/bots/price-changer-bot/handlers/reports.handler';
import { OrderReportsService } from '../../src/modules/yandex/reports/order-reports.service';
import { YandexMarketService } from '../../src/database/services/yandex-market.service';
import { REPORT } from '../../src/modules/yandex/reports/report-status-map';
import {
  MENU,
  MENU_LABELS,
} from '../../src/modules/telegram/bots/price-changer-bot/menu.constants';
import { YandexAuthError, YandexRateLimitError } from '../../src/modules/yandex/yandex-api.errors';

const STORE = { token: 'ACMA:x', campaign_id: '1', business_id: '2' };

async function build(opts: { store?: unknown; build?: () => Promise<unknown> } = {}) {
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

  const moduleRef = await Test.createTestingModule({
    providers: [
      ReportsHandler,
      { provide: OrderReportsService, useValue: reports },
      { provide: YandexMarketService, useValue: yandexMarketService },
    ],
  }).compile();

  return { handler: moduleRef.get(ReportsHandler), reports };
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
  });

  it('все четыре метки отчётов есть в справочнике меню', () => {
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

    await handler.handle(ctx as never, REPORT.REDEEMED);

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

    const first = handler.handle(ctx as never, REPORT.REDEEMED);
    await handler.handle(ctx as never, REPORT.REDEEMED);

    expect(reports.build).toHaveBeenCalledTimes(1);
    expect(ctx.texts().some((t) => t.includes('уже собирается'))).toBe(true);

    release!();
    await first;
  });

  it('после завершения защёлка снимается', async () => {
    const { handler, reports } = await build();
    const ctx = fakeCtx();

    await handler.handle(ctx as never, REPORT.REDEEMED);
    await handler.handle(ctx as never, REPORT.REDEEMED);

    expect(reports.build).toHaveBeenCalledTimes(2);
  });

  it('ОШИБКА тоже снимает защёлку — иначе отчёты запираются до рестарта', async () => {
    const { handler, reports } = await build({
      build: async () => {
        throw new YandexRateLimitError('quota', 420);
      },
    });
    const ctx = fakeCtx();

    await handler.handle(ctx as never, REPORT.REDEEMED);
    await handler.handle(ctx as never, REPORT.REDEEMED);

    expect(reports.build).toHaveBeenCalledTimes(2);
  });

  it('доменная ошибка показывается понятным текстом, а не молчанием', async () => {
    const { handler } = await build({
      build: async () => {
        throw new YandexAuthError('unauthorized', 401);
      },
    });
    const ctx = fakeCtx();

    await handler.handle(ctx as never, REPORT.REDEEMED);

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

    await handler.handle(ctx as never, REPORT.REDEEMED);

    const last = ctx.texts().at(-1)!;
    expect(last).toContain('Попробуйте позже');
    expect(last).not.toContain('ECONNREFUSED');
  });

  it('без настроек API отчёт не запрашивается', async () => {
    const { handler, reports } = await build({ store: null });
    const ctx = fakeCtx();

    await handler.handle(ctx as never, REPORT.REDEEMED);

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
