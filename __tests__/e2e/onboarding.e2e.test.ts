import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ErrorReporter } from '../../src/modules/errors/error-reporter.service';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import axios from 'axios';

import { PriceChangerComposer } from '../../src/modules/telegram/bots/price-changer-bot/price-changer.composer';
import { AccessGateHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/access-gate.handler';
import { FeatureGateHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/feature-gate.handler';
import { ActionLogHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/action-log.handler';
import { ActionLogService } from '../../src/database/services/action-log.service';
import { ActionLog } from '../../src/database/schemas/action-log.schema';
import { StartHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/start.handler';
import { MenuCommandsHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/menu-commands.handler';
import { SlashCommandsHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/slash-commands.handler';
import { SharedCommandsHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/shared-commands.handler';
import { CallbackQueryHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/callback-query.handler';
import { AdminApprovalHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/admin-approval.handler';
import { ScheduleHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/schedule.handler';
import { ReportsHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/reports.handler';
import { WarehousesHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/warehouses.handler';
import { WarehousesService } from '../../src/modules/yandex/warehouses/warehouses.service';
import { reportCallback } from '../../src/modules/telegram/bots/price-changer-bot/report-buttons';
import { PERIOD } from '../../src/modules/yandex/reports/report-period';
import { REPORT } from '../../src/modules/yandex/reports/report-status-map';
import { ApiSettingsHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/api-settings.handler';
import { StockUploadHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/stock-upload.handler';
import { AdminUsersHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/admin-users.handler';
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
import { ProfitService } from '../../src/modules/yandex/reports/profit.service';
import { PurchasePriceService } from '../../src/database/services/purchase-price.service';
import { PurchasePrice } from '../../src/database/schemas/purchase-price.schema';
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

  /**
   * Возвраты, которые отдаёт метод возвратов. По умолчанию их нет — так и у
   * боевого магазина: в API возвратов пусто.
   */
  let apiReturns: Array<Record<string, unknown>>;

  /**
   * Заказы, ОФОРМЛЕННЫЕ за период, — второй набор отчёта о прибыли.
   *
   * По умолчанию пусто: у большинства тестов речь про выкупленные, и лишний
   * набор только зашумил бы их числа. Тесты про два блока задают его сами.
   */
  let apiPlacedOrders: Array<Record<string, unknown>>;

  async function build() {
    apiCalls = [];
    apiReturns = [];
    apiPlacedOrders = [];

    vi.spyOn(axios, 'create').mockImplementation(
      () =>
        ({
          interceptors: { response: { use: () => undefined } },
          get: async (path: string, opts: { params: Record<string, unknown> }) => {
            apiCalls.push({ path, params: opts?.params ?? {} });

            // Возвраты — отдельный метод и отдельная сущность: заказ при возврате
            // остаётся в DELIVERED, поэтому подменять надо именно этот ответ.
            if (path.includes('/returns')) {
              // null означает «метод возвратов отказал» — так проверяется, что
              // отчёт это переживает, а не что мы просто получили пустой список.
              if (apiReturns === null) throw new Error('500 Internal Server Error');
              return { data: { returns: apiReturns } };
            }

            // Заказы, ОФОРМЛЕННЫЕ за период, — это отдельный запрос с другим
            // фильтром даты (fromDate/toDate). Отвечать на него тем же списком
            // выкупленных нельзя: наборы разные по определению, и заглушка,
            // которая их путает, скрыла бы ровно ту ошибку, ради которой
            // отчёт переделывали.
            if (opts?.params?.fromDate) {
              return { data: { orders: apiPlacedOrders } };
            }

            return {
              data: {
                orders: [
                  {
                    id: 1,
                    status: 'DELIVERED',
                    itemsTotal: 1000,
                    deliveryTotal: 200,
                    // Позиции нужны прибыли: закуп сходится с продажей только
                    // по offerId. Приходили они всегда — отчёты их не читали.
                    items: [{ offerId: 'FAA02006M', offerName: 'ORIENT', count: 1 }],
                  },
                ],
              },
            };
          },
        }) as never,
    );

    const accessModel = inMemoryModel();
    const logsModel = inMemoryModel();
    const marketModel = inMemoryModel();
    const scheduleModel = inMemoryModel();
    // Цена ПРАЙСА 400; закуп — минус скидка 10 % = 360.
    // Итого: 1000 продажа − 230 комиссия − 70 налог − 360 закуп = 340.
    const pricesModel = inMemoryModel([
      {
        telegramUserId: String(USER_ID),
        sku: 'FAA02006M',
        price: 400,
        name: 'ORIENT FAA02006M',
        category: 'ORIENT механические',
        updatedAt: new Date(),
      },
    ]);

    const scheduler = {
      schedule: vi.fn(async () => undefined),
      unschedule: vi.fn(async () => undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        // Ловитель ошибок: в тестах он заглушка — предмет проверки здесь
        // другой, а без провайдера DI не соберётся.
        { provide: ErrorReporter, useValue: { report: async () => undefined } },
        PriceChangerComposer,
        // Журнал действий — часть живого пайплайна, поэтому он здесь настоящий:
        // сквозной тест должен ловить и то, что запись действия сломает диалог.
        ActionLogHandler,
        ActionLogService,
        AccessGateHandler,
        FeatureGateHandler,
        StartHandler,
        MenuCommandsHandler,
        SlashCommandsHandler,
        SharedCommandsHandler,
        CallbackQueryHandler,
        AdminApprovalHandler,
        ScheduleHandler,
        ReportsHandler,
        WarehousesHandler,
        WarehousesService,
        ApiSettingsHandler,
        StockUploadHandler,
        AdminUsersHandler,
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
        ProfitService,
        PurchasePriceService,
        { provide: getModelToken(ActionLog.name), useValue: logsModel },
        { provide: getModelToken(UserAccess.name), useValue: accessModel },
        { provide: getModelToken(ReportSchedule.name), useValue: scheduleModel },
        { provide: getModelToken(YandexMarket.name), useValue: marketModel },
        { provide: getModelToken(PurchasePrice.name), useValue: pricesModel },
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

    return { fake, accessModel, marketModel, pricesModel, scheduler };
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
    // Спрашивается ТОЛЬКО токен: campaign_id и business_id бот определяет по
    // нему сам, и нумерации «Шаг 1 из 3» больше нет.
    expect(harness.fake.lastTextTo(USER_ID)).toContain('API-токен');

    // Кнопка отчёта до заполнения кредов не работает и в Яндекс не ходит.
    await send(MENU.REDEEMED);
    expect(harness.fake.lastTextTo(USER_ID)).toContain('заявку на доступ');
    expect(apiCalls).toHaveLength(0);

    // В этом сценарии автоопределение магазинов не срабатывает, поэтому визард
    // отступает на ручной ввод — тот самый запасной путь.
    await send(CREDS.token);
    expect(harness.fake.lastTextTo(USER_ID)).toContain('Campaign ID');
    // Документа магазина ещё нет: он создаётся один раз и сразу целиком.
    expect(harness.marketModel.documents).toHaveLength(0);

    await send(CREDS.campaign_id);
    expect(harness.fake.lastTextTo(USER_ID)).toContain('Business ID');
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

    // Кнопка отчёта сначала спрашивает период и в Яндекс ещё не ходит.
    await send(MENU.REDEEMED);
    expect(apiCalls).toHaveLength(0);
    expect(harness.fake.lastTextTo(USER_ID)).toContain('за какой период');

    await tap(reportCallback(PERIOD.TODAY, REPORT.REDEEMED));

    // Запрос ушёл, путь версионированный, фильтр — по updatedAt со смещением.
    expect(apiCalls).toHaveLength(1);
    expect(apiCalls[0].path).toContain('/v2/campaigns/12345678/orders');
    expect(String(apiCalls[0].params.updatedAtFrom)).toMatch(/\+03:00$/);

    const text = harness.fake.lastTextTo(USER_ID);
    expect(text).toContain('Заказов');
    expect(text).toContain('Товары');
  });

  it('прибыль считается по закупу из базы и сходится с суммой продажи', async () => {
    await send('/start');
    await send(CREDS.token);
    await send(CREDS.campaign_id);
    await send(CREDS.business_id);
    await tap(formatAdminCallback('approve', USER_ID), admin);

    apiCalls.length = 0;

    await send(MENU.PROFIT);
    expect(apiCalls).toHaveLength(0);
    expect(harness.fake.lastTextTo(USER_ID)).toContain('за какой период');

    await tap(reportCallback(PERIOD.TODAY, REPORT.PROFIT));

    // Заказы берутся тем же методом, что у «Выкуплено»: статус DELIVERED.
    expect(apiCalls[0].path).toContain('/v2/campaigns/12345678/orders');
    // Плюс метод возвратов: возврат ПОСЛЕ выкупа заказ из DELIVERED не выводит,
    // и без этого запроса возвращённый заказ остался бы в прибыли.
    expect(apiCalls.map((c) => c.path)).toContainEqual(
      expect.stringContaining('/v2/campaigns/12345678/returns'),
    );
    // Третий запрос — заказы, ОФОРМЛЕННЫЕ за период: другой фильтр даты, тем же
    // запросом их не получить.
    expect(apiCalls.filter((c) => c.params.fromDate)).toHaveLength(1);
    expect(apiCalls).toHaveLength(3);

    const text = harness.fake.lastTextTo(USER_ID);
    // Прайс 400 минус скидка 10 % = закуп 360.
    // 1000 продажа − 230 комиссия − 70 налог − 360 закуп = 340 чистая.
    // Продажи — itemsTotal, ровно как в отчёте «Выкуплено»; доставка (200) в
    // расчёт не входит.
    expect(text).toContain('Продажи');
    expect(text).toMatch(/1[\s ]000/);
    expect(text).toContain('Комиссия 23%');
    expect(text).toContain('230');
    expect(text).toContain('Налог 7%');
    expect(text).toContain('360');
    expect(text).toContain('Чистая');
    expect(text).toMatch(/340[\s ]₽/);
    expect(text).toContain('минус 10%');
    // Ни одного исключённого заказа: закуп известен по всем позициям.
    expect(text).not.toContain('Не учтено');
  });

  it('заказ без закупа в прибыль не попадает, но и не исчезает молча', async () => {
    await send('/start');
    await send(CREDS.token);
    await send(CREDS.campaign_id);
    await send(CREDS.business_id);
    await tap(formatAdminCallback('approve', USER_ID), admin);

    // Закупа по артикулу заказа больше нет.
    harness.pricesModel.documents.length = 0;

    await send(MENU.PROFIT);
    await tap(reportCallback(PERIOD.TODAY, REPORT.PROFIT));

    const text = harness.fake.lastTextTo(USER_ID);
    expect(text).toContain('Не учтено заказов');
    expect(text).toContain('FAA02006M');
    // Чистой прибыли не показываем вовсе: считать её было бы не по чему.
    expect(text).not.toContain('Чистая');
  });

  it('изменённая ставка сразу меняет расчёт', async () => {
    await send('/start');
    await send(CREDS.token);
    await send(CREDS.campaign_id);
    await send(CREDS.business_id);
    await tap(formatAdminCallback('approve', USER_ID), admin);

    await send('комиссия: 50');
    expect(harness.fake.lastTextTo(USER_ID)).toContain('50%');

    await send(MENU.PROFIT);
    await tap(reportCallback(PERIOD.TODAY, REPORT.PROFIT));

    const text = harness.fake.lastTextTo(USER_ID);
    // 1000 − 500 комиссия − 70 налог − 360 закуп = 70.
    expect(text).toContain('Комиссия 50%');
    expect(text).toMatch(/70[\s ]₽/);
  });

  it('заказ с возвратом исключается из прибыли ЦЕЛИКОМ', async () => {
    // Возврат после выкупа заказ из DELIVERED не выводит — он живёт отдельной
    // сущностью в методе возвратов. Без её опроса деньги, вернувшиеся покупателю,
    // так и остались бы в прибыли.
    await send('/start');
    await send(CREDS.token);
    await send(CREDS.campaign_id);
    await send(CREDS.business_id);
    await tap(formatAdminCallback('approve', USER_ID), admin);

    apiReturns = [{ returnId: 77, orderId: 1, amount: { value: 1000, currencyId: 'RUR' } }];

    await send(MENU.PROFIT);
    await tap(reportCallback(PERIOD.TODAY, REPORT.PROFIT));

    const text = harness.fake.lastTextTo(USER_ID);
    expect(text).toContain('Возвраты');
    expect(text).toMatch(/1[\s ]000[\s ]₽/);
    // Единственный заказ ушёл в возврат, значит считать нечего: ни выручки,
    // ни закупа, ни чистой.
    expect(text).not.toContain('Чистая');
    expect(text).not.toContain('➖ Закуп');
    // И это НЕ «нет закупочной цены» — прайс тут ни при чём.
    expect(text).not.toContain('Не учтено');
  });

  it('возврат считается раньше отсутствия закупа: продавца не гоняют за прайсом', async () => {
    await send('/start');
    await send(CREDS.token);
    await send(CREDS.campaign_id);
    await send(CREDS.business_id);
    await tap(formatAdminCallback('approve', USER_ID), admin);

    // Закуп по позиции стираем И оформляем возврат: заказ обязан попасть в
    // «Возвраты», а не в «нет закупочной цены».
    harness.pricesModel.documents.length = 0;
    apiReturns = [{ returnId: 77, orderId: 1, amount: { value: 1000, currencyId: 'RUR' } }];

    await send(MENU.PROFIT);
    await tap(reportCallback(PERIOD.TODAY, REPORT.PROFIT));

    const text = harness.fake.lastTextTo(USER_ID);
    expect(text).toContain('Возвраты');
    expect(text).not.toContain('Не учтено');
  });

  it('оформленные и выкупленные показаны обе цифры и названы разными', async () => {
    // Продавец сверяется с кабинетом, где видит ОФОРМЛЕННЫЕ заказы. Пока отчёт
    // показывал только выкупленные, 11 против 9 читалось как поломка.
    await send('/start');
    await send(CREDS.token);
    await send(CREDS.campaign_id);
    await send(CREDS.business_id);
    await tap(formatAdminCallback('approve', USER_ID), admin);

    apiPlacedOrders = [
      {
        id: 2,
        status: 'PROCESSING',
        itemsTotal: 2000,
        items: [{ offerId: 'FAA02006M', offerName: 'ORIENT', count: 1 }],
      },
      { id: 3, status: 'CANCELLED', itemsTotal: 900, items: [] },
    ];

    await send(MENU.PROFIT);
    await tap(reportCallback(PERIOD.TODAY, REPORT.PROFIT));

    const text = harness.fake.lastTextTo(USER_ID);

    // Оформлено: 2000 − 460 комиссия − 140 налог − 360 закуп = 1040.
    expect(text).toContain('Оформлено');
    expect(text).toMatch(/1[\s ]040/);
    expect(text).toContain('Ожидается чистая');
    // Выкупленное — строкой, с той же чистой 340, что и в отчёте по одному набору.
    expect(text).toContain('Выкуплено');
    expect(text).toMatch(/340[\s ]₽/);
    expect(text).toContain('Это другие заказы');
    // Отменённый в деньги не идёт, но назван: в кабинете продавец его видит.
    expect(text).toContain('Отменено');
    expect(text).not.toMatch(/900[\s ]₽/);
  });

  it('отказ метода возвратов НЕ роняет отчёт о прибыли', async () => {
    // Прибыль без вычета возвратов полезнее сообщения об ошибке.
    await send('/start');
    await send(CREDS.token);
    await send(CREDS.campaign_id);
    await send(CREDS.business_id);
    await tap(formatAdminCallback('approve', USER_ID), admin);

    apiReturns = null as never; // ответ метода возвратов сломан

    await send(MENU.PROFIT);
    await tap(reportCallback(PERIOD.TODAY, REPORT.PROFIT));

    const text = harness.fake.lastTextTo(USER_ID);
    expect(text).toContain('Чистая');
    expect(text).toMatch(/340[\s ]₽/);
  });

  it('скидка от прайса меняется БЕЗ перезагрузки прайса', async () => {
    // В базе лежит цена прайса, а не закуп, — именно поэтому смена процента
    // действует сразу. Если бы скидка применялась при записи, отчёт до новой
    // загрузки файла показывал бы старые числа.
    await send('/start');
    await send(CREDS.token);
    await send(CREDS.campaign_id);
    await send(CREDS.business_id);
    await tap(formatAdminCallback('approve', USER_ID), admin);

    await send('скидка: 50');
    expect(harness.fake.lastTextTo(USER_ID)).toContain('50%');

    await send(MENU.PROFIT);
    await tap(reportCallback(PERIOD.TODAY, REPORT.PROFIT));

    const text = harness.fake.lastTextTo(USER_ID);
    // Прайс 400 минус 50 % = закуп 200; 1000 − 230 − 70 − 200 = 500.
    expect(text).toContain('минус 50%');
    expect(text).toContain('200');
    expect(text).toMatch(/500[\s ]₽/);
    // Цена в базе не тронута — менялась только настройка.
    expect(harness.pricesModel.documents[0].price).toBe(400);
  });

  it('«скидка восток» правит ДРУГОЙ процент, а не общую скидку', async () => {
    await send('/start');
    await send(CREDS.token);
    await send(CREDS.campaign_id);
    await send(CREDS.business_id);
    await tap(formatAdminCallback('approve', USER_ID), admin);

    await send('скидка восток: 30');
    expect(harness.fake.lastTextTo(USER_ID)).toContain('Восток');

    await send(MENU.PROFIT);
    await tap(reportCallback(PERIOD.TODAY, REPORT.PROFIT));

    const text = harness.fake.lastTextTo(USER_ID);
    // Товар в заказе — ORIENT, поэтому считается по ОБЩЕЙ скидке 10 %: 340.
    expect(text).toContain('минус 10%');
    expect(text).toContain('Восток 30%');
    expect(text).toMatch(/340[\s ]₽/);
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
