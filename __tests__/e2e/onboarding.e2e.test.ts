import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import axios from 'axios';

import { PriceChangerComposer } from '../../src/modules/telegram/bots/price-changer-bot/price-changer.composer';
import { AccessGateHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/access-gate.handler';
import { StartHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/start.handler';
import { MenuCommandsHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/menu-commands.handler';
import { SlashCommandsHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/slash-commands.handler';
import { SharedCommandsHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/shared-commands.handler';
import { CallbackQueryHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/callback-query.handler';
import { AdminApprovalHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/admin-approval.handler';
import { ScheduleHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/schedule.handler';
import { ReportsHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/reports.handler';
import { ApiSettingsHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/api-settings.handler';
import { StockUploadHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/stock-upload.handler';
import { StockSyncService } from '../../src/modules/yandex/stocks/stock-sync.service';
import { FallbackHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/fallback.handler';
import { PriceChangerKeyboard } from '../../src/modules/telegram/bots/price-changer-bot/price-changer.keyboard';
import { AdminNotifierService } from '../../src/modules/telegram/bots/shared/services/admin-notifier.service';
import { ReportSchedulerService } from '../../src/modules/telegram/queue/services/report-scheduler.service';

import { UserAccessService } from '../../src/database/services/user-access.service';
import { ReportScheduleService } from '../../src/database/services/report-schedule.service';
import { YandexMarketService } from '../../src/database/services/yandex-market.service';
import { UserAccess } from '../../src/database/schemas/user-access.schema';
import { ReportSchedule } from '../../src/database/schemas/report-schedule.schema';
import { YandexMarket } from '../../src/database/schemas/yandex-market.schema';
import { AppConfigService } from '../../src/config/app-config.service';
import { YandexClientFactory } from '../../src/modules/yandex/yandex-client.factory';
import { OrderReportsService } from '../../src/modules/yandex/reports/order-reports.service';
import { formatAdminCallback } from '../../src/modules/telegram/bots/shared/access.domain';
import { MENU } from '../../src/modules/telegram/bots/price-changer-bot/menu.constants';

import { inMemoryModel } from '../helpers/in-memory-model';
import { createFakeBot } from '../helpers/fake-bot';

const ADMIN_ID = 111;
const USER_ID = 222;
const BOT_ID = 999;

const CREDS = {
  token: 'ACMA:bhD15nJMV71y4UZPbAFOVTZvNVGgHzkfPIH9QdWm',
  campaign_id: '12345678',
  business_id: '87654321',
};

/**
 * Сквозной тест онбординга: от первого /start до отчёта.
 *
 * Идёт через НАСТОЯЩИЙ пайплайн композера — гейт, визард, кнопки, — а не через
 * отдельно взятый обработчик. Внешнего мира два: Partner API (подменён axios) и
 * Telegram (подменён fake-bot). Боевые креды не нужны.
 */
describe('Онбординг: от /start до отчёта', () => {
  let harness: Awaited<ReturnType<typeof build>>;

  /** Запросы, ушедшие в Partner API. Пусто — значит запроса не было. */
  let apiCalls: Array<{ path: string; params: Record<string, unknown> }>;

  async function build() {
    apiCalls = [];

    vi.spyOn(axios, 'create').mockImplementation(
      () =>
        ({
          interceptors: { response: { use: () => undefined } },
          get: async (path: string, opts: { params: Record<string, unknown> }) => {
            apiCalls.push({ path, params: opts?.params ?? {} });
            return {
              data: {
                orders: [{ id: 1, status: 'DELIVERED', itemsTotal: 1000, deliveryTotal: 200 }],
              },
            };
          },
        }) as never,
    );

    const accessModel = inMemoryModel();
    const marketModel = inMemoryModel();
    const scheduleModel = inMemoryModel();

    const scheduler = {
      schedule: vi.fn(async () => undefined),
      unschedule: vi.fn(async () => undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PriceChangerComposer,
        AccessGateHandler,
        StartHandler,
        MenuCommandsHandler,
        SlashCommandsHandler,
        SharedCommandsHandler,
        CallbackQueryHandler,
        AdminApprovalHandler,
        ScheduleHandler,
        ReportsHandler,
        ApiSettingsHandler,
        StockUploadHandler,
        // Загрузка остатков в этом сценарии не участвует, но обработчик —
        // часть пайплайна, и без заглушки его зависимость не резолвится.
        { provide: StockSyncService, useValue: { sync: async () => ({}) } },
        FallbackHandler,
        PriceChangerKeyboard,
        AdminNotifierService,
        UserAccessService,
        ReportScheduleService,
        YandexMarketService,
        YandexClientFactory,
        OrderReportsService,
        { provide: getModelToken(UserAccess.name), useValue: accessModel },
        { provide: getModelToken(ReportSchedule.name), useValue: scheduleModel },
        { provide: getModelToken(YandexMarket.name), useValue: marketModel },
        { provide: ReportSchedulerService, useValue: scheduler },
        {
          provide: AppConfigService,
          useValue: {
            telegramAdminIds: [ADMIN_ID],
            isAdmin: (id: number) => id === ADMIN_ID,
            yandexMarketBaseUrl: 'https://api.partner.market.yandex.ru',
          },
        },
      ],
    }).compile();

    const composer = moduleRef.get(PriceChangerComposer);
    const fake = createFakeBot(BOT_ID);
    await composer.compose(fake.bot as never);

    return { fake, accessModel, marketModel, scheduler };
  }

  const user = { id: USER_ID, username: 'vasya', first_name: 'Вася' };
  const admin = { id: ADMIN_ID, username: 'boss', first_name: 'Босс' };

  const send = (text: string, from = user) => harness.fake.dispatch({ from, text });
  const tap = (callbackData: string, from = user) => harness.fake.dispatch({ from, callbackData });

  beforeEach(async () => {
    harness = await build();
  });
  afterEach(() => vi.restoreAllMocks());

  it('визард спрашивает креды ПО ОДНОМУ и не пускает дальше', async () => {
    await send('/start');
    expect(harness.fake.lastTextTo(USER_ID)).toContain('Шаг 1 из 3');

    // Кнопка отчёта до заполнения кредов не работает и в Яндекс не ходит.
    await send(MENU.REDEEMED);
    expect(harness.fake.lastTextTo(USER_ID)).toContain('заявку на доступ');
    expect(apiCalls).toHaveLength(0);

    await send(CREDS.token);
    expect(harness.fake.lastTextTo(USER_ID)).toContain('Шаг 2 из 3');
    // Документа магазина ещё нет: он создаётся один раз и сразу целиком.
    expect(harness.marketModel.documents).toHaveLength(0);

    await send(CREDS.campaign_id);
    expect(harness.fake.lastTextTo(USER_ID)).toContain('Шаг 3 из 3');
    expect(harness.marketModel.documents).toHaveLength(0);
  });

  it('после третьего креда документ создан целиком и заявка ушла админу', async () => {
    await send('/start');
    await send(CREDS.token);
    await send(CREDS.campaign_id);
    await send(CREDS.business_id);

    expect(harness.marketModel.documents).toHaveLength(1);
    expect(harness.marketModel.documents[0]).toMatchObject(CREDS);

    expect(harness.fake.lastTextTo(USER_ID)).toContain('Заявка отправлена');
    expect(harness.fake.textsTo(ADMIN_ID).join(' ')).toContain('Новая регистрация');
  });

  it('пока заявка на рассмотрении, отчёт не отдаётся и запрос не уходит', async () => {
    await send('/start');
    await send(CREDS.token);
    await send(CREDS.campaign_id);
    await send(CREDS.business_id);
    apiCalls.length = 0;

    await send(MENU.REDEEMED);

    expect(harness.fake.lastTextTo(USER_ID)).toContain('рассмотрении');
    expect(apiCalls).toHaveLength(0);
  });

  it('после одобрения отчёт отдаётся и запрос в Partner API уходит', async () => {
    await send('/start');
    await send(CREDS.token);
    await send(CREDS.campaign_id);
    await send(CREDS.business_id);

    await tap(formatAdminCallback('approve', USER_ID), admin);
    expect(harness.fake.lastTextTo(USER_ID)).toContain('Доступ открыт');

    apiCalls.length = 0;
    await send(MENU.REDEEMED);

    // Запрос ушёл, путь версионированный, фильтр — по updatedAt со смещением.
    expect(apiCalls).toHaveLength(1);
    expect(apiCalls[0].path).toContain('/v2/campaigns/12345678/orders');
    expect(String(apiCalls[0].params.updatedAtFrom)).toMatch(/\+03:00$/);

    const text = harness.fake.lastTextTo(USER_ID);
    expect(text).toContain('Заказов');
    expect(text).toContain('Товары');
  });

  it('отказ стирает креды и закрывает повторную регистрацию на сутки', async () => {
    await send('/start');
    await send(CREDS.token);
    await send(CREDS.campaign_id);
    await send(CREDS.business_id);

    await tap(formatAdminCallback('reject', USER_ID), admin);

    expect(harness.marketModel.documents).toHaveLength(0);
    expect(harness.fake.lastTextTo(USER_ID)).toContain('отклонена');

    // Даже ввод креда теперь отбивается.
    await send(CREDS.token);
    expect(harness.fake.lastTextTo(USER_ID)).toContain('Повторная регистрация');
  });

  it('одобренный настраивает рассылку, и расписание создаётся', async () => {
    await send('/start');
    await send(CREDS.token);
    await send(CREDS.campaign_id);
    await send(CREDS.business_id);
    await tap(formatAdminCallback('approve', USER_ID), admin);

    await send(MENU.SCHEDULE);
    expect(harness.fake.lastTextTo(USER_ID)).toContain('по Москве');

    await tap('sch:on:redeemed');
    expect(harness.scheduler.schedule).toHaveBeenCalledTimes(1);

    // Некорректное время отвергается с повторным запросом.
    await tap('sch:time:redeemed');
    await send('25:00');
    expect(harness.fake.lastTextTo(USER_ID)).toContain('Попробуйте ещё раз');

    await send('21:30');
    expect(harness.fake.textsTo(USER_ID).join(' ')).toContain('21:30');
  });

  it('посторонний не может одобрить заявку — его отбивает гейт', async () => {
    await send('/start');
    await send(CREDS.token);
    await send(CREDS.campaign_id);
    await send(CREDS.business_id);

    // Незнакомый пользователь до обработчика админских кнопок не доходит
    // вообще: гейт закрывает ему все колбэки, кроме подсказок онбординга.
    const stranger = { id: 777, first_name: 'Чужой' };
    await tap(formatAdminCallback('approve', USER_ID), stranger);

    apiCalls.length = 0;
    await send(MENU.REDEEMED);
    expect(harness.fake.lastTextTo(USER_ID)).toContain('рассмотрении');
    expect(apiCalls).toHaveLength(0);
  });

  it('одобренный продавец, не админ, получает отказ по правам', async () => {
    // Второй рубеж: гейт такого пользователя пропускает (у него есть доступ),
    // и заявку защищает уже проверка ctx.from.id в обработчике кнопок.
    const seller = { id: 333, username: 'petya', first_name: 'Петя' };

    await harness.fake.dispatch({ from: seller, text: '/start' });
    await harness.fake.dispatch({ from: seller, text: CREDS.token });
    await harness.fake.dispatch({ from: seller, text: '55555555' });
    await harness.fake.dispatch({ from: seller, text: '66666666' });
    await tap(formatAdminCallback('approve', seller.id), admin);

    // Заявка первого пользователя.
    await send('/start');
    await send(CREDS.token);
    await send(CREDS.campaign_id);
    await send(CREDS.business_id);

    await harness.fake.dispatch({
      from: seller,
      callbackData: formatAdminCallback('approve', USER_ID),
    });

    expect(harness.fake.alerts.join(' ')).toContain('прав');

    // И доступ первому пользователю так и не выдан.
    apiCalls.length = 0;
    await send(MENU.REDEEMED);
    expect(harness.fake.lastTextTo(USER_ID)).toContain('рассмотрении');
    expect(apiCalls).toHaveLength(0);
  });
});
