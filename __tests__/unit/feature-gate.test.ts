import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';

import { AppConfigService } from '../../src/config/app-config.service';
import { UserAccessService } from '../../src/database/services/user-access.service';
import { FeatureGateHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/feature-gate.handler';
import { MENU } from '../../src/modules/telegram/bots/price-changer-bot/menu.constants';
import {
  reportCallback,
  scheduleCallback,
} from '../../src/modules/telegram/bots/price-changer-bot/report-buttons';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { PERIOD } from '../../src/modules/yandex/reports/report-period';
import { REPORT } from '../../src/modules/yandex/reports/report-status-map';

/**
 * Гейт возможностей: пускать ли ЭТОТ апдейт к ЭТОЙ функции бота.
 *
 * Проверяется отдельно от гейта доступа: тот отвечает на вопрос «пускать ли
 * человека в бота вообще», этот — «открыта ли ему вот эта кнопка». Внешних
 * подключений нет: telegraf подменён заглушкой, Mongo не нужен.
 */
describe('FeatureGateHandler', () => {
  const ADMIN_ID = 111;
  const USER_ID = 222;
  const BOT_ID = 999;

  let features: Record<string, boolean> | undefined;
  let findByUserAndBot: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    features = undefined;
    findByUserAndBot = vi.fn(async () => ({
      telegramUserId: String(USER_ID),
      botId: String(BOT_ID),
      features,
    }));
  });

  async function buildGate() {
    const moduleRef = await Test.createTestingModule({
      providers: [
        FeatureGateHandler,
        { provide: UserAccessService, useValue: { findByUserAndBot } },
        { provide: AppConfigService, useValue: { isAdmin: (id: number) => id === ADMIN_ID } },
      ],
    }).compile();
    return moduleRef.get(FeatureGateHandler);
  }

  /** Прогоняет один апдейт через middleware гейта. */
  async function run(update: {
    text?: string;
    callbackData?: string;
    hasDocument?: boolean;
    fromId?: number;
  }) {
    const gate = await buildGate();
    let middleware: (ctx: unknown, next: () => Promise<void>) => Promise<unknown>;
    gate.register({ use: (fn: never) => (middleware = fn) } as never);

    const message =
      update.text !== undefined || update.hasDocument
        ? { text: update.text, document: update.hasDocument ? { file_id: 'f' } : undefined }
        : undefined;

    const ctx = {
      from: { id: update.fromId ?? USER_ID, username: 'vasya', first_name: 'Вася' },
      chat: { id: 555, type: 'private' },
      botInfo: { id: BOT_ID },
      message,
      callbackQuery: update.callbackData === undefined ? undefined : { data: update.callbackData },
      reply: vi.fn(async () => undefined),
      answerCbQuery: vi.fn(async () => undefined),
    };
    const next = vi.fn(async () => undefined);

    await middleware!(ctx, next);
    return { ctx, next };
  }

  it('администратор проходит при любых флагах', async () => {
    // Записи доступа у администратора нет вовсе — флагов для него не
    // существует, и спрашивать базу незачем.
    features = { [FEATURE.REPORT_PROFIT]: false };
    const { next } = await run({ text: MENU.PROFIT, fromId: ADMIN_ID });

    expect(next).toHaveBeenCalled();
    expect(findByUserAndBot).not.toHaveBeenCalled();
  });

  it('апдейт, не связанный ни с одной возможностью, НЕ читает базу', async () => {
    // Ранний выход принципиален: свободный текст, онбординг, настройки и
    // справка — это большинство апдейтов, и лишнего запроса на них быть не
    // должно.
    const { next } = await run({ text: 'ACMA:секретный-токен' });

    expect(next).toHaveBeenCalled();
    expect(findByUserAndBot).not.toHaveBeenCalled();
  });

  it('открытая возможность пропускается', async () => {
    features = { [FEATURE.REPORT_PROFIT]: true };
    const { next, ctx } = await run({ text: MENU.PROFIT });

    expect(next).toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it('отсутствие записи о флаге — это умолчание реестра, то есть «открыто»', async () => {
    features = undefined;
    const { next } = await run({ text: MENU.PROFIT });

    expect(next).toHaveBeenCalled();
  });

  it('закрытая кнопка отвечает текстом и НЕ идёт дальше', async () => {
    features = { [FEATURE.REPORT_PROFIT]: false };
    const { next, ctx } = await run({ text: MENU.PROFIT });

    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalled();
    expect(String(ctx.reply.mock.calls[0][0])).toContain(MENU.PROFIT);
  });

  it('закрытая inline-кнопка отвечает всплывающим окном и НЕ идёт дальше', async () => {
    // Не звать next() обязательно: default-ветка общего обработчика
    // callback_query перезаписала бы сообщение «Неизвестной командой».
    features = { [FEATURE.REPORT_PROFIT]: false };
    const { next, ctx } = await run({ callbackData: reportCallback(PERIOD.MONTH, REPORT.PROFIT) });

    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(ctx.answerCbQuery).toHaveBeenCalledWith(expect.stringContaining(MENU.PROFIT), {
      show_alert: true,
    });
  });

  it('закрытие одного отчёта не задевает соседний', async () => {
    features = { [FEATURE.REPORT_PROFIT]: false };
    const { next } = await run({ text: MENU.REDEEMED });

    expect(next).toHaveBeenCalled();
  });

  it('документ гейт пропускает даже при выключенных фичах прайса', async () => {
    // Прайс делает два независимых дела (закуп и остатки), и исход бывает
    // частичным — «разобрать файл, но не писать остатки». Гейт умеет отбить
    // апдейт только целиком, поэтому решение принимает stock-upload.handler,
    // а гейт по документам молчит.
    features = { [FEATURE.PURCHASE_PRICES]: false, [FEATURE.STOCK_UPDATE]: false };
    const { next, ctx } = await run({ hasDocument: true });

    expect(next).toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it('включение рассылки закрытого отчёта не проходит, хотя рассылка открыта', async () => {
    features = { [FEATURE.SCHEDULE]: true, [FEATURE.REPORT_PROFIT]: false };
    const { next } = await run({ callbackData: scheduleCallback('on', REPORT.PROFIT) });

    expect(next).not.toHaveBeenCalled();
  });

  it('закрытая рассылка закрывает и раздел целиком', async () => {
    features = { [FEATURE.SCHEDULE]: false };
    const { next } = await run({ text: MENU.SCHEDULE });

    expect(next).not.toHaveBeenCalled();
  });

  it('настройки и справка не закрываются никогда', async () => {
    // Иначе продавец запрётся снаружи собственных настроек и не сможет ни
    // сменить токен, ни прочитать, к кому обращаться.
    features = Object.fromEntries(Object.values(FEATURE).map((key) => [key, false]));

    for (const label of [MENU.SETTINGS, MENU.HELP, MENU.PROFILE, MENU.MAIN]) {
      const { next } = await run({ text: label });
      expect(next).toHaveBeenCalled();
    }
  });

  it('апдейт без отправителя проходит мимо', async () => {
    const gate = await buildGate();
    let middleware: (ctx: unknown, next: () => Promise<void>) => Promise<unknown>;
    gate.register({ use: (fn: never) => (middleware = fn) } as never);

    const next = vi.fn(async () => undefined);
    await middleware!({ from: undefined }, next);

    expect(next).toHaveBeenCalled();
  });
});
