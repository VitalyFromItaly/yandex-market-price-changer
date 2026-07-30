import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { YandexClientFactory } from '../../src/modules/yandex/yandex-client.factory';
import { YandexAuthError, YandexNetworkError } from '../../src/modules/yandex/yandex-api.errors';
import { ApiSettingsHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/api-settings.handler';
import { PriceChangerKeyboard } from '../../src/modules/telegram/bots/price-changer-bot/price-changer.keyboard';
import { YandexMarketService } from '../../src/database/services/yandex-market.service';
import { UserAccessService } from '../../src/database/services/user-access.service';
import { AdminNotifierService } from '../../src/modules/telegram/bots/shared/services/admin-notifier.service';
import { AppConfigService } from '../../src/config/app-config.service';
import { ScheduleHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/schedule.handler';
import { ReportsHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/reports.handler';

/**
 * Подача заявки: ветка, где сходятся черновик кредов, атомарный переход статуса
 * и рассылка администраторам.
 */
describe('ApiSettingsHandler: подача заявки', () => {
  const ADMIN_ID = 111;
  const USER_ID = 222;

  const FULL = {
    campaign_id: '12345',
    business_id: '67890',
    token: 'ACMA:token:value',
  };

  async function build(opts: {
    status?: string;
    draft?: Record<string, string>;
    store?: Record<string, string> | null;
    delivered?: number;
    /** Что вернёт listStores(); по умолчанию — пусто, то есть «не определилось». */
    stores?: unknown[];
    /** Чем упадёт listStores(), если задано. */
    listStoresError?: Error;
  }) {
    const state = {
      status: opts.status ?? 'new',
      draft: { ...(opts.draft ?? {}) },
    };

    const accessService = {
      ensure: vi.fn(async () => ({ ...state, telegramUserId: String(USER_ID), botId: '999' })),
      // Статус читается и здесь: submitApplication отличает уже одобренного
      // пользователя (он меняет магазин) от новичка (он подаёт заявку).
      findByUserAndBot: vi.fn(async () => ({
        ...state,
        draft: { ...state.draft },
        telegramUserId: String(USER_ID),
        botId: '999',
      })),
      saveDraftField: vi.fn(async (_u: string, _b: string, field: string, value: string) => {
        state.draft[field] = value;
        return { draft: { ...state.draft } };
      }),
      clearDraftField: vi.fn(async (_u: string, _b: string, field: string) => {
        delete state.draft[field];
        return { draft: { ...state.draft } };
      }),
      clearDraft: vi.fn(async () => {
        state.draft = {};
        return { draft: {} };
      }),
      tryApply: vi.fn(async () =>
        state.status === 'new' ? { ...state, status: 'pending' } : null,
      ),
      revertApply: vi.fn(async () => ({ ...state, status: 'new' })),
      grant: vi.fn(async () => ({ ...state, status: 'approved' })),
    };

    const yandexMarketService = {
      // Правка настройки допустима только когда магазин уже есть: одобренный
      // без магазина всё ещё подключается, и его текст должен идти в визард.
      isConfigured: vi.fn(
        async () => !!(opts.store?.campaign_id && opts.store?.business_id && opts.store?.token),
      ),
      findByTelegramUser: vi.fn(async () => opts.store ?? null),
      updateByTelegramUser: vi.fn(async () => opts.store ?? null),
      updateRate: vi.fn(async () => opts.store ?? null),
      create: vi.fn(async (data: unknown) => data),
      deleteByTelegramUser: vi.fn(async () => true),
    };

    const adminNotifier = {
      sendApplication: vi.fn(async () => opts.delivered ?? 1),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ApiSettingsHandler,
        {
          // Автоподстановка id по токену: в этих сценариях сеть не нужна,
          // пустой список магазинов означает «не определилось» — визард
          // продолжится ручным вводом, как и раньше.
          provide: YandexClientFactory,
          useValue: {
            forTokenOnly: () => ({
              listStores: async () => {
                if (opts.listStoresError) throw opts.listStoresError;
                return opts.stores ?? [];
              },
            }),
          },
        },
        PriceChangerKeyboard,
        { provide: YandexMarketService, useValue: yandexMarketService },
        { provide: UserAccessService, useValue: accessService },
        { provide: AdminNotifierService, useValue: adminNotifier },
        // Незакрытых вопросов (про время рассылки и про день отчёта) в этих
        // сценариях нет — текст должен доходить до визарда.
        { provide: ScheduleHandler, useValue: { handlePendingTime: async () => false } },
        { provide: ReportsHandler, useValue: { handlePendingDay: async () => false } },
        {
          provide: AppConfigService,
          useValue: { isAdmin: (id: number) => id === ADMIN_ID, telegramAdminIds: [ADMIN_ID] },
        },
      ],
    }).compile();

    return {
      handler: moduleRef.get(ApiSettingsHandler),
      accessService,
      yandexMarketService,
      adminNotifier,
    };
  }

  /** Прогоняет один текстовый апдейт через обработчик. */
  async function send(handler: ApiSettingsHandler, text: string, fromId = USER_ID) {
    let onText: (ctx: unknown) => Promise<void>;
    handler.register({
      on: (event: string, fn: never) => {
        if (event === 'text') onText = fn;
      },
      // register вешает ещё и action — подсказку «Как получить?» по шагу.
      action: () => undefined,
    } as never);

    const ctx = {
      from: { id: fromId, username: 'vasya', first_name: 'Вася' },
      chat: { id: 555 },
      botInfo: { id: 999 },
      message: { text },
      reply: vi.fn(async () => undefined),
    };
    await onText!(ctx);
    return {
      ctx,
      reply: () => String(ctx.reply.mock.calls[0]?.[0] ?? ''),
      // Обработчик может ответить несколько раз: applyStore шлёт «Подключаю
      // магазин…» сам, а итог возвращается вызывающему отдельным сообщением.
      allReplies: () => ctx.reply.mock.calls.map((c) => String(c[0] ?? '')).join('\n'),
    };
  }

  it('первый кред сохраняется в черновик, а не падает на required-полях схемы', async () => {
    // Прежде это был create() с одним полем → ValidationError → пользователь
    // видел «Ошибка сохранения данных в базу» и не мог зарегистрироваться.
    const { handler, yandexMarketService } = await build({});
    const { reply } = await send(handler, FULL.token);

    expect(yandexMarketService.create).not.toHaveBeenCalled();
    // Магазинов по токену не нашлось (стаб отдаёт []), поэтому визард
    // отступает на ручной ввод и спрашивает Campaign ID.
    expect(reply()).toContain('Campaign ID');
  });

  it('визард спрашивает креды ПО ОДНОМУ, а не все три сразу', async () => {
    const { handler } = await build({});
    const first = await send(handler, 'привет');

    // На первом шаге в сообщении есть только токен — Campaign/Business ID
    // упоминаться не должны, иначе это снова «пришлите три значения».
    expect(first.reply()).toContain('API-токен');
    expect(first.reply()).not.toContain('Business ID');
  });

  it('неверное значение переспрашивает ТОТ ЖЕ шаг с объяснением', async () => {
    // Раньше на непопадание в шаблон бот отвечал «Не удалось определить тип
    // данных» — пользователь не понимал, что именно у него не так.
    const { handler, accessService } = await build({});
    const { reply } = await send(handler, 'кор');

    expect(accessService.saveDraftField).not.toHaveBeenCalled();
    expect(reply()).toContain('слишком короткий');
    expect(reply()).toContain('API-токен');
    expect(reply()).not.toContain('undefined');
  });

  it('число из 5–15 цифр больше не вызывает встречный вопрос «уточните тип»', async () => {
    // Это и был главный симптом отсутствия состояния: бот не знал, что спросил,
    // и переспрашивал пользователя, campaign это или business.
    const { handler, accessService } = await build({
      draft: { token: FULL.token },
    });
    const { reply } = await send(handler, '12345678');

    expect(accessService.saveDraftField).toHaveBeenCalledWith(
      String(USER_ID),
      '999',
      'campaign_id',
      '12345678',
    );
    expect(reply()).not.toContain('Уточните');
    expect(reply()).toContain('Business ID');
  });

  it('подписанное значение уходит в НАЗВАННОЕ поле, даже если спрошено другое', async () => {
    // Это не догадка по форме строки — тип назвал сам пользователь.
    const { handler, accessService } = await build({});
    await send(handler, 'business_id: 87654321');

    expect(accessService.saveDraftField).toHaveBeenCalledWith(
      String(USER_ID),
      '999',
      'business_id',
      '87654321',
    );
  });

  it('токен не отображается пользователю целиком', async () => {
    const { handler } = await build({});
    const { reply } = await send(handler, FULL.token);

    expect(reply()).not.toContain(FULL.token);
    expect(reply()).toContain(FULL.token.slice(0, 10));
  });

  it('третий кред подаёт заявку и создаёт магазин целиком', async () => {
    const { handler, yandexMarketService, adminNotifier, accessService } = await build({
      draft: { campaign_id: FULL.campaign_id, business_id: FULL.business_id },
    });
    const { reply } = await send(handler, `token: ${FULL.token}`);

    expect(accessService.tryApply).toHaveBeenCalledTimes(1);
    expect(yandexMarketService.create).toHaveBeenCalledWith(expect.objectContaining(FULL));
    expect(adminNotifier.sendApplication).toHaveBeenCalledTimes(1);
    expect(reply()).toContain('Заявка отправлена');
  });

  it('повторная отправка креда НЕ шлёт вторую заявку', async () => {
    // Заполненность истинна и после подачи — признаком служит переход статуса.
    const { handler, adminNotifier } = await build({
      status: 'pending',
      draft: { campaign_id: FULL.campaign_id, business_id: FULL.business_id },
    });
    const { reply } = await send(handler, `token: ${FULL.token}`);

    expect(adminNotifier.sendApplication).not.toHaveBeenCalled();
    expect(reply()).toContain('уже отправлена');
  });

  it('если карточку не получил ни один админ — статус и магазин откатываются', async () => {
    // Иначе пользователь навсегда завис бы в pending, а оставшийся магазин
    // увёл бы его следующий ввод в ветку «правка настройки».
    const { handler, accessService, yandexMarketService } = await build({
      draft: { campaign_id: FULL.campaign_id, business_id: FULL.business_id },
      delivered: 0,
    });
    const { reply } = await send(handler, `token: ${FULL.token}`);

    expect(accessService.revertApply).toHaveBeenCalledTimes(1);
    expect(yandexMarketService.deleteByTelegramUser).toHaveBeenCalledTimes(1);
    expect(reply()).toContain('Не удалось отправить заявку');
  });

  it('НЕодобренный с уже существующим магазином всё равно подаёт заявку', async () => {
    // Тупик: документ остаётся от прежней версии бота или от отката заявки.
    // Если ветку выбирать по наличию документа, ввод креда молча обновлял
    // магазин, статус навсегда оставался new и заявка не уходила никогда.
    const { handler, adminNotifier, yandexMarketService } = await build({
      status: 'new',
      draft: { campaign_id: FULL.campaign_id, business_id: FULL.business_id },
      store: { ...FULL },
    });
    const { reply } = await send(handler, `token: ${FULL.token}`);

    expect(adminNotifier.sendApplication).toHaveBeenCalledTimes(1);
    // Второй документ не заводим — unique-индекса у YandexMarket нет.
    expect(yandexMarketService.create).not.toHaveBeenCalled();
    expect(yandexMarketService.updateByTelegramUser).toHaveBeenCalled();
    expect(reply()).toContain('Заявка отправлена');
  });

  it('одобренный правит настройку без заявки администратору', async () => {
    const { handler, adminNotifier, yandexMarketService } = await build({
      status: 'approved',
      store: { ...FULL },
    });
    const { reply } = await send(handler, `campaign_id: 55555`);

    expect(adminNotifier.sendApplication).not.toHaveBeenCalled();
    expect(yandexMarketService.updateByTelegramUser).toHaveBeenCalledWith(String(USER_ID), {
      campaign_id: '55555',
    });
    expect(reply()).toContain('обновлена');
  });

  it('администратор-продавец получает доступ сразу, без карточки самому себе', async () => {
    const { handler, adminNotifier, accessService } = await build({
      draft: { campaign_id: FULL.campaign_id, business_id: FULL.business_id },
    });
    const { reply } = await send(handler, `token: ${FULL.token}`, ADMIN_ID);

    expect(adminNotifier.sendApplication).not.toHaveBeenCalled();
    expect(accessService.grant).toHaveBeenCalledTimes(1);
    // Сообщение об УСПЕХЕ говорит о том, что произошло, — подключён магазин.
    // Прежнее «Все настройки API заполнены» осталось от снятой логики, где
    // признаком успеха считалась заполненность полей.
    expect(reply()).toContain('Магазин подключён');
  });

  it('одобренному без подписи объясняют формат, а не молчат', async () => {
    const { handler, yandexMarketService } = await build({
      status: 'approved',
      store: { ...FULL },
    });
    const { reply } = await send(handler, 'просто текст');

    expect(yandexMarketService.updateByTelegramUser).not.toHaveBeenCalled();
    expect(reply()).toContain('token:');
    expect(reply()).not.toContain('undefined');
    // Про campaign_id и business_id больше не рассказываем: их не вводят
    // руками и на экране настроек не показывают.
    expect(reply()).not.toContain('campaign_id:');
    expect(reply()).not.toContain('business_id:');
    // Зато про ставки прибыли рассказываем: их правят именно так.
    expect(reply()).toContain('комиссия:');
    expect(reply()).toContain('налог:');
  });

  it('одобренный меняет ставку прибыли — числом, а не строкой', async () => {
    const { handler, yandexMarketService, adminNotifier } = await build({
      status: 'approved',
      store: { ...FULL },
    });
    const { reply } = await send(handler, 'комиссия: 25');

    expect(adminNotifier.sendApplication).not.toHaveBeenCalled();
    expect(yandexMarketService.updateRate).toHaveBeenCalledWith(
      String(USER_ID),
      'commissionPercent',
      25,
    );
    // Не строкой '25': в схеме поле числовое, и полагаться на приведение
    // mongoose при записи не стоит.
    expect(yandexMarketService.updateRate.mock.calls[0][2]).toBeTypeOf('number');
    expect(reply()).toContain('25%');
  });

  it('ставка вне 0–100 отклоняется и в базу не идёт', async () => {
    const { handler, yandexMarketService } = await build({
      status: 'approved',
      store: { ...FULL },
    });
    const { reply } = await send(handler, 'налог: 200');

    expect(yandexMarketService.updateRate).not.toHaveBeenCalled();
    expect(reply()).toContain('процентах');
  });

  it('ставка НЕ путается с токеном и не уезжает в визард', async () => {
    const { handler, yandexMarketService, accessService } = await build({
      status: 'approved',
      store: { ...FULL },
    });
    await send(handler, 'налог: 6');

    expect(yandexMarketService.updateRate).toHaveBeenCalledWith(String(USER_ID), 'taxPercent', 6);
    // Черновик не тронут: правка ставки — не перерегистрация магазина.
    expect(accessService.clearDraft).not.toHaveBeenCalled();
  });

  it('одобренный БЕЗ магазина присылает голый токен — и это работает', async () => {
    // Тупик: доступ выдал администратор, магазина ещё нет. Такой пользователь
    // попадал в editSetting, тот требовал подписи `token: …` и на голый токен
    // отвечал «Не понял, что именно нужно изменить» — бот отвергал ровно то,
    // что сам только что попросил прислать.
    const { handler, yandexMarketService } = await build({
      status: 'approved',
      store: null,
      stores: [
        {
          campaignId: '777',
          businessId: '888',
          businessName: 'NEW BIZ',
          storeName: 'newstore.ru',
        },
      ],
    });
    const { allReplies } = await send(handler, FULL.token);

    expect(allReplies()).not.toContain('Не понял');
    expect(yandexMarketService.create).toHaveBeenCalledWith(
      expect.objectContaining({ campaign_id: '777', business_id: '888', name: 'newstore.ru' }),
    );
    expect(allReplies()).toContain('Магазин подключён');
  });

  it('отклонённый Маркетом токен НЕ уводит на ручной ввод, а переспрашивается', async () => {
    // Прежде autofillFromToken ловил любую ошибку и молча возвращал черновик:
    // продавец с отозванным или read-only токеном получал вопрос про Campaign
    // ID вместо диагноза — причём ровно ту работу, от которой его избавили.
    const { handler, accessService } = await build({
      listStoresError: new YandexAuthError('403 Forbidden', 403),
    });
    const { reply } = await send(handler, FULL.token);

    expect(reply()).toContain('отклонил ваш API-токен');
    // Негодный токен снят с черновика, иначе nextStep решил бы, что он собран.
    expect(accessService.clearDraftField).toHaveBeenCalledWith(String(USER_ID), '999', 'token');
    // И снова спрашиваем именно токен, а не следующее поле.
    expect(reply()).toContain('API-токен');
    expect(reply()).not.toContain('Campaign ID');
  });

  it('недоступность Яндекса токен НЕ бракует — визард отступает на ручной ввод', async () => {
    // Запереть человека из-за того, что Яндекс лежит, хуже, чем спросить
    // два числа. Отказ в доступе и недоступность API — разные вещи.
    const { handler, accessService } = await build({
      listStoresError: new YandexNetworkError('ECONNRESET'),
    });
    const { reply } = await send(handler, FULL.token);

    expect(accessService.clearDraftField).not.toHaveBeenCalled();
    expect(reply()).toContain('Campaign ID');
  });

  it('одобренный меняет магазин новым токеном, а не получает «заявка уже отправлена»', async () => {
    // Экран настроек прямо обещает «чтобы сменить магазин — пришлите новый
    // токен». Раньше editSetting писал ОДИН token, оставляя campaign_id,
    // business_id и название от прежнего магазина, а submitApplication для
    // одобренного отвечал «Заявка уже отправлена администратору» — ответ не о
    // том, что человек сделал.
    const { handler, adminNotifier, yandexMarketService } = await build({
      status: 'approved',
      store: { ...FULL, name: 'newstore.ru' },
      stores: [
        {
          campaignId: '777',
          businessId: '888',
          businessName: 'NEW BIZ',
          storeName: 'newstore.ru',
        },
      ],
    });
    const { allReplies } = await send(handler, `token: ${FULL.token}`);

    expect(adminNotifier.sendApplication).not.toHaveBeenCalled();
    // Перезаписаны ВСЕ поля магазина, а не только токен.
    expect(yandexMarketService.updateByTelegramUser).toHaveBeenCalledWith(
      String(USER_ID),
      expect.objectContaining({
        token: FULL.token,
        campaign_id: '777',
        business_id: '888',
        name: 'newstore.ru',
      }),
    );
    expect(allReplies()).toContain('Магазин подключён');
    expect(allReplies()).not.toContain('уже отправлена');
  });
});
