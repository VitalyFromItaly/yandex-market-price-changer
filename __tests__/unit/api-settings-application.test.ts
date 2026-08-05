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
import { ErrorReporter } from '../../src/modules/errors/error-reporter.service';
import { PurchasePriceService } from '../../src/database/services/purchase-price.service';

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
    /** unknown, а не string: у магазина есть и вложенные настройки (promoCommissions). */
    store?: Record<string, unknown> | null;
    delivered?: number;
    /** Что вернёт listStores(); по умолчанию — пусто, то есть «не определилось». */
    stores?: unknown[];
    /** Чем упадёт listStores(), если задано. */
    listStoresError?: Error;
    /** Открытый вопрос про ставку — как если бы кнопку уже нажали. */
    pendingRate?: string;
    /** Подмена вопроса про день отчёта: им проверяется порядок pending-проверок. */
    pendingDay?: () => Promise<boolean>;
    /** Явные решения по фичам — как их хранит UserAccess.features. */
    features?: Record<string, boolean>;
  }) {
    const state = {
      status: opts.status ?? 'new',
      draft: { ...(opts.draft ?? {}) },
      /** Незакрытый вопрос «какую ставку меняем» — как его хранит UserAccess. */
      pendingRate: opts.pendingRate,
      features: opts.features,
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
      setPendingRate: vi.fn(async (_u: string, _b: string, field: string | null) => {
        state.pendingRate = field ?? undefined;
        return { ...state };
      }),
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
      updateBrandDiscount: vi.fn(async () => opts.store ?? null),
      updatePromoCommission: vi.fn(async () => opts.store ?? null),
      create: vi.fn(async (data: unknown) => data),
      deleteByTelegramUser: vi.fn(async () => true),
    };

    // Список брендов на экране скидок; в этих сценариях сам список не важен.
    const purchasePrices = {
      listNamesAndCategories: vi.fn(async () => [{ name: 'Восток Амфибия 420831' }]),
    };

    const adminNotifier = {
      sendApplication: vi.fn(async () => opts.delivered ?? 1),
    };

    const errors = { report: vi.fn(async () => undefined) };

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
        {
          provide: ReportsHandler,
          useValue: { handlePendingDay: opts.pendingDay ?? (async () => false) },
        },
        {
          provide: AppConfigService,
          useValue: { isAdmin: (id: number) => id === ADMIN_ID, telegramAdminIds: [ADMIN_ID] },
        },
        { provide: ErrorReporter, useValue: errors },
        { provide: PurchasePriceService, useValue: purchasePrices },
      ],
    }).compile();

    return {
      handler: moduleRef.get(ApiSettingsHandler),
      accessService,
      yandexMarketService,
      adminNotifier,
      errors,
      purchasePrices,
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

  /**
   * Нажимает inline-кнопку обработчика.
   *
   * Кнопки живут в registerCallbacks(), а НЕ в register(): `bot.action` не
   * вызывает next(), поэтому общий обработчик callback_query, стоящий раньше,
   * съел бы их вместе с ответом «Эта кнопка устарела» (так уже ломался пикер
   * магазина). Здесь собираем зарегистрированные пары «шаблон → обработчик» и
   * вызываем ту, чей шаблон совпал, — ровно как это сделает telegraf.
   */
  async function tap(handler: ApiSettingsHandler, data: string, fromId = USER_ID) {
    const actions: { pattern: RegExp; fn: (ctx: unknown) => Promise<void> }[] = [];
    handler.registerCallbacks({
      action: (pattern: RegExp, fn: never) => actions.push({ pattern, fn }),
    } as never);

    const ctx = {
      from: { id: fromId, username: 'vasya', first_name: 'Вася' },
      chat: { id: 555 },
      botInfo: { id: 999 },
      callbackQuery: { data },
      answerCbQuery: vi.fn(async () => undefined),
      reply: vi.fn(async () => undefined),
    };

    const matched = actions.filter((a) => a.pattern.test(data));
    for (const action of matched) {
      await action.fn(ctx);
    }

    return {
      ctx,
      matched: matched.length,
      allReplies: () => ctx.reply.mock.calls.map((c) => String(c[0] ?? '')).join('\n'),
      /** reply_markup последнего ответа — им проверяются кнопки под сообщением. */
      lastMarkup: () => {
        const last = ctx.reply.mock.calls[ctx.reply.mock.calls.length - 1];
        return JSON.stringify((last?.[1] as { reply_markup?: unknown })?.reply_markup ?? {});
      },
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

  /**
   * Правка ставок КНОПКОЙ.
   *
   * Текстовый ввод («комиссия: 25») работал и раньше, но узнать о нём было
   * негде: в интерфейсе не было ни одной кнопки, а подсказки на экране стояли
   * литералами с чужими значениями.
   */
  it('нажатие кнопки открывает вопрос про ставку и в магазин ничего не пишет', async () => {
    const { handler, yandexMarketService, accessService } = await build({
      status: 'approved',
      store: { ...FULL },
    });
    const { ctx, allReplies } = await tap(handler, 'rate:commissionPercent');

    expect(ctx.answerCbQuery).toHaveBeenCalled();
    expect(accessService.setPendingRate).toHaveBeenCalledWith(
      String(USER_ID),
      '999',
      'commissionPercent',
    );
    // Вопрос — это ещё не правка: до ответа пользователя в базе ничего не меняется.
    expect(yandexMarketService.updateRate).not.toHaveBeenCalled();
    expect(allReplies()).toContain('Комиссия');
    expect(allReplies()).toContain('23%');
  });

  it('ответ числом сохраняет ставку и закрывает вопрос', async () => {
    const { handler, yandexMarketService, accessService } = await build({
      status: 'approved',
      store: { ...FULL },
      pendingRate: 'commissionPercent',
    });
    const { allReplies } = await send(handler, '25');

    expect(yandexMarketService.updateRate).toHaveBeenCalledWith(
      String(USER_ID),
      'commissionPercent',
      25,
    );
    expect(yandexMarketService.updateRate.mock.calls[0][2]).toBeTypeOf('number');
    // Вопрос закрыт: следующее число не должно снова уехать в комиссию.
    expect(accessService.setPendingRate).toHaveBeenCalledWith(String(USER_ID), '999', null);
    expect(allReplies()).toContain('25%');
    // И сразу экран настроек — чтобы правка второй ставки была следующим тапом.
    expect(allReplies()).toContain('Настройки');
  });

  it('ответ вне 0–100 не сохраняется, а вопрос остаётся открытым', async () => {
    const { handler, yandexMarketService, accessService } = await build({
      status: 'approved',
      store: { ...FULL },
      pendingRate: 'taxPercent',
    });
    const { allReplies } = await send(handler, '200');

    expect(yandexMarketService.updateRate).not.toHaveBeenCalled();
    expect(accessService.setPendingRate).not.toHaveBeenCalled();
    expect(allReplies()).toContain('процентах');
  });

  /**
   * Главный риск порядка: handlePendingRate стоит ПЕРВЫМ, раньше вопросов про
   * день отчёта и время рассылки. Безопасно это ровно потому, что он забирает
   * только числовой ввод.
   */
  it('дата при открытом вопросе про ставку уходит в отчёт, а не в ставку', async () => {
    const pendingDay = vi.fn(async () => true);
    const { handler, yandexMarketService } = await build({
      status: 'approved',
      store: { ...FULL },
      pendingRate: 'commissionPercent',
      pendingDay,
    });
    await send(handler, '28-07-2026');

    expect(yandexMarketService.updateRate).not.toHaveBeenCalled();
    expect(pendingDay).toHaveBeenCalled();
  });

  it('кнопка ставки без магазина не открывает вопрос, а просит токен', async () => {
    const { handler, accessService } = await build({
      status: 'approved',
      store: null,
    });
    const { allReplies } = await tap(handler, 'rate:taxPercent');

    // Вопрос НЕ открываем: писать ставку некуда, и присланное число повисло бы
    // в воздухе.
    expect(accessService.setPendingRate).not.toHaveBeenCalled();
    expect(allReplies()).toContain('подключите магазин');
  });

  it('«Отмена» снимает вопрос и возвращает экран настроек', async () => {
    const { handler, yandexMarketService, accessService } = await build({
      status: 'approved',
      store: { ...FULL },
      pendingRate: 'taxPercent',
    });
    const { allReplies } = await tap(handler, 'rate:cancel');

    expect(accessService.setPendingRate).toHaveBeenCalledWith(String(USER_ID), '999', null);
    expect(yandexMarketService.updateRate).not.toHaveBeenCalled();
    expect(allReplies()).toContain('Настройки');
  });

  /**
   * Скидки по брендам живут в том же диалоге, что и ставки: вопрос открывает
   * кнопка `bdisc:<ключ>`, ответ разбирает handlePendingRate по значению
   * `brand:<ключ>` в pendingRate, запись идёт в updateBrandDiscount, а не в
   * updateRate.
   */
  it('кнопка бренда открывает вопрос, ответ пишет скидку бренда', async () => {
    const { handler, yandexMarketService, accessService } = await build({
      status: 'approved',
      store: { ...FULL },
    });
    const { allReplies } = await tap(handler, 'bdisc:casio');

    expect(accessService.setPendingRate).toHaveBeenCalledWith(
      String(USER_ID),
      '999',
      'brand:casio',
    );
    expect(yandexMarketService.updateBrandDiscount).not.toHaveBeenCalled();
    expect(allReplies()).toContain('CASIO');
  });

  it('ответ числом на брендовый вопрос сохраняет скидку бренда и закрывает вопрос', async () => {
    const { handler, yandexMarketService, accessService } = await build({
      status: 'approved',
      store: { ...FULL },
      pendingRate: 'brand:casio',
    });
    const { allReplies } = await send(handler, '5');

    expect(yandexMarketService.updateBrandDiscount).toHaveBeenCalledWith(
      String(USER_ID),
      'casio',
      5,
    );
    expect(yandexMarketService.updateRate).not.toHaveBeenCalled();
    expect(accessService.setPendingRate).toHaveBeenCalledWith(String(USER_ID), '999', null);
    // Возврат на экран брендов, а не в настройки: продавец правил его.
    expect(allReplies()).toContain('Скидки по брендам');
  });

  it('легаси-вопрос про «⌚ Восток» разрешается скидкой бренда vostok', async () => {
    // pendingRate='vostokDiscountPercent' мог остаться открытым с прежней
    // версии, где Восток был ставкой; ответ не должен зависнуть.
    const { handler, yandexMarketService } = await build({
      status: 'approved',
      store: { ...FULL },
      pendingRate: 'vostokDiscountPercent',
    });
    await send(handler, '3');

    expect(yandexMarketService.updateBrandDiscount).toHaveBeenCalledWith(
      String(USER_ID),
      'vostok',
      3,
    );
  });

  it('старая кнопка «⌚ Восток» из истории чата открывает брендовый вопрос', async () => {
    const { handler, accessService } = await build({
      status: 'approved',
      store: { ...FULL },
    });
    await tap(handler, 'rate:vostokDiscountPercent');

    expect(accessService.setPendingRate).toHaveBeenCalledWith(
      String(USER_ID),
      '999',
      'brand:vostok',
    );
  });

  it('«скидка casio: 5» сообщением пишет скидку бренда, «скидка: 10» — общую', async () => {
    const first = await build({ status: 'approved', store: { ...FULL } });
    await send(first.handler, 'скидка casio: 5');

    expect(first.yandexMarketService.updateBrandDiscount).toHaveBeenCalledWith(
      String(USER_ID),
      'casio',
      5,
    );
    expect(first.yandexMarketService.updateRate).not.toHaveBeenCalled();

    // Общая подпись не должна перехватываться брендовым парсером.
    const second = await build({ status: 'approved', store: { ...FULL } });
    await send(second.handler, 'скидка: 10');

    expect(second.yandexMarketService.updateRate).toHaveBeenCalledWith(
      String(USER_ID),
      'discountPercent',
      10,
    );
    expect(second.yandexMarketService.updateBrandDiscount).not.toHaveBeenCalled();
  });

  it('кнопка «Скидки по брендам» показывает бренды из закупочных цен', async () => {
    const { handler, purchasePrices } = await build({
      status: 'approved',
      store: { ...FULL },
    });
    const { allReplies } = await tap(handler, 'bdisc:menu');

    expect(purchasePrices.listNamesAndCategories).toHaveBeenCalledWith(String(USER_ID));
    expect(allReplies()).toContain('Скидки по брендам');
    // В фейке лежит «Восток Амфибия …» — бренд обязан быть найден.
    expect(allReplies()).toContain('Восток');
  });

  /**
   * Продвижение: тот же диалог «кнопка → вопрос → ответ», но пошаговый.
   * Промежуточные ответы живут в строке pendingRate, запись в магазин — ОДНА,
   * после последнего шага (updatePromoCommission).
   */
  it('кнопка «Продвижение» показывает бренды из закупочных цен', async () => {
    const { handler, purchasePrices, accessService } = await build({
      status: 'approved',
      store: { ...FULL },
    });
    const { allReplies } = await tap(handler, 'promo:menu');

    expect(purchasePrices.listNamesAndCategories).toHaveBeenCalledWith(String(USER_ID));
    expect(allReplies()).toContain('Продвижение');
    expect(allReplies()).toContain('Восток');
    expect(accessService.setPendingRate).not.toHaveBeenCalled();
  });

  it('выбор бренда открывает развилку «общий процент / от суммы»', async () => {
    const { handler, accessService } = await build({
      status: 'approved',
      store: { ...FULL },
    });
    const { allReplies, lastMarkup } = await tap(handler, 'promo:pick:vostok');

    expect(allReplies()).toContain('Восток');
    expect(lastMarkup()).toContain('promo:flat:vostok');
    expect(lastMarkup()).toContain('promo:tier:vostok');
    // Развилка — ещё не вопрос: pendingRate не открывается до выбора формы.
    expect(accessService.setPendingRate).not.toHaveBeenCalled();
  });

  it('общий процент: кнопка открывает вопрос, ответ пишет плоскую настройку', async () => {
    const { handler, yandexMarketService, accessService } = await build({
      status: 'approved',
      store: { ...FULL },
    });
    await tap(handler, 'promo:flat:casio');

    expect(accessService.setPendingRate).toHaveBeenCalledWith(
      String(USER_ID),
      '999',
      'promo:casio:flat',
    );
    expect(yandexMarketService.updatePromoCommission).not.toHaveBeenCalled();

    const { allReplies } = await send(handler, '2');

    expect(yandexMarketService.updatePromoCommission).toHaveBeenCalledWith(String(USER_ID), 'casio', {
      mode: 'flat',
      percent: 2,
    });
    expect(accessService.setPendingRate).toHaveBeenCalledWith(String(USER_ID), '999', null);
    expect(allReplies()).toContain('2%');
  });

  it('ступени: три ответа подряд, запись в магазин РОВНО одна — в конце', async () => {
    const { handler, yandexMarketService, accessService } = await build({
      status: 'approved',
      store: { ...FULL },
    });
    await tap(handler, 'promo:tier:casio');
    expect(accessService.setPendingRate).toHaveBeenCalledWith(
      String(USER_ID),
      '999',
      'promo:casio:limit',
    );

    // Порог принимается и с пробелами, и со знаком рубля.
    const step1 = await send(handler, '10 000 ₽');
    expect(accessService.setPendingRate).toHaveBeenCalledWith(
      String(USER_ID),
      '999',
      'promo:casio:below:10000',
    );
    expect(step1.allReplies()).toContain('Шаг 2 из 3');
    expect(yandexMarketService.updatePromoCommission).not.toHaveBeenCalled();

    const step2 = await send(handler, '2');
    expect(accessService.setPendingRate).toHaveBeenCalledWith(
      String(USER_ID),
      '999',
      'promo:casio:above:10000:2',
    );
    expect(step2.allReplies()).toContain('Шаг 3 из 3');
    expect(yandexMarketService.updatePromoCommission).not.toHaveBeenCalled();

    await send(handler, '1');
    expect(yandexMarketService.updatePromoCommission).toHaveBeenCalledTimes(1);
    expect(yandexMarketService.updatePromoCommission).toHaveBeenCalledWith(String(USER_ID), 'casio', {
      mode: 'tiered',
      limit: 10000,
      below: 2,
      above: 1,
    });
  });

  it('отмена посреди цепочки снимает вопрос и ничего не пишет', async () => {
    const { handler, yandexMarketService, accessService } = await build({
      status: 'approved',
      store: { ...FULL },
      pendingRate: 'promo:casio:below:10000',
    });
    const { allReplies } = await tap(handler, 'promo:cancel');

    expect(accessService.setPendingRate).toHaveBeenCalledWith(String(USER_ID), '999', null);
    expect(yandexMarketService.updatePromoCommission).not.toHaveBeenCalled();
    // Возврат на экран продвижения: продавец правил его.
    expect(allReplies()).toContain('Продвижение');
  });

  it('нечисловой ответ закрывает промо-вопрос и не делает бота глухим', async () => {
    const { handler, yandexMarketService, accessService } = await build({
      status: 'approved',
      store: { ...FULL },
      pendingRate: 'promo:casio:limit',
    });
    await send(handler, 'привет');

    expect(accessService.setPendingRate).toHaveBeenCalledWith(String(USER_ID), '999', null);
    expect(yandexMarketService.updatePromoCommission).not.toHaveBeenCalled();
  });

  it('порог ноль не сохраняется, вопрос остаётся открытым', async () => {
    const { handler, yandexMarketService, accessService } = await build({
      status: 'approved',
      store: { ...FULL },
      pendingRate: 'promo:casio:limit',
    });
    const { allReplies } = await send(handler, '0');

    expect(yandexMarketService.updatePromoCommission).not.toHaveBeenCalled();
    expect(accessService.setPendingRate).not.toHaveBeenCalled();
    expect(allReplies()).toContain('больше нуля');
  });

  it('ответ при выключенной фиче — отказ и закрытие вопроса', async () => {
    // Пока вопрос оставался открытым, фичу могли закрыть из панели. Ответ
    // приходит текстом — мимо гейта, который видит только кнопки.
    const { handler, yandexMarketService, accessService } = await build({
      status: 'approved',
      store: { ...FULL },
      pendingRate: 'promo:casio:flat',
      features: { promotion: false },
    });
    const { allReplies } = await send(handler, '2');

    expect(yandexMarketService.updatePromoCommission).not.toHaveBeenCalled();
    expect(accessService.setPendingRate).toHaveBeenCalledWith(String(USER_ID), '999', null);
    expect(allReplies()).toContain('недоступн');
  });

  /**
   * Нижний порог — поле поверх действующей настройки, а не отдельный режим:
   * кнопка живёт на развилке настроенного бренда, ответ дописывает `from` в
   * текущую конфигурацию одной записью, «0» его убирает.
   */
  const CONFIGURED = { ...FULL, promoCommissions: { casio: { mode: 'flat', percent: 2 } } };

  it('кнопка порога есть только у настроенного бренда', async () => {
    const configured = await build({ status: 'approved', store: { ...CONFIGURED } });
    const withConfig = await tap(configured.handler, 'promo:pick:casio');
    expect(withConfig.lastMarkup()).toContain('promo:floor:casio');

    const empty = await build({ status: 'approved', store: { ...FULL } });
    const withoutConfig = await tap(empty.handler, 'promo:pick:casio');
    expect(withoutConfig.lastMarkup()).not.toContain('promo:floor:casio');
  });

  it('нижний порог: вопрос и ответ дописывают from в текущую настройку', async () => {
    const { handler, yandexMarketService, accessService } = await build({
      status: 'approved',
      store: { ...CONFIGURED },
    });
    await tap(handler, 'promo:floor:casio');

    expect(accessService.setPendingRate).toHaveBeenCalledWith(
      String(USER_ID),
      '999',
      'promo:casio:from',
    );
    expect(yandexMarketService.updatePromoCommission).not.toHaveBeenCalled();

    const { allReplies } = await send(handler, '3 000 ₽');

    expect(yandexMarketService.updatePromoCommission).toHaveBeenCalledTimes(1);
    expect(yandexMarketService.updatePromoCommission).toHaveBeenCalledWith(String(USER_ID), 'casio', {
      mode: 'flat',
      percent: 2,
      from: 3000,
    });
    expect(allReplies()).toContain('от 3');
  });

  it('ноль убирает порог: ключ from в записи не остаётся', async () => {
    const { handler, yandexMarketService } = await build({
      status: 'approved',
      store: { ...FULL, promoCommissions: { casio: { mode: 'flat', percent: 2, from: 3000 } } },
      pendingRate: 'promo:casio:from',
    });
    await send(handler, '0');

    const written = yandexMarketService.updatePromoCommission.mock.calls[0][2];
    expect(written).toStrictEqual({ mode: 'flat', percent: 2 });
  });

  it('порог у ненастроенного бренда: отказ, вопрос не открывается', async () => {
    // Кнопка живёт в истории чата вечно — настройку могли отключить после неё.
    const { handler, accessService, yandexMarketService } = await build({
      status: 'approved',
      store: { ...FULL },
    });
    const { allReplies } = await tap(handler, 'promo:floor:casio');

    expect(accessService.setPendingRate).not.toHaveBeenCalled();
    expect(yandexMarketService.updatePromoCommission).not.toHaveBeenCalled();
    expect(allReplies()).toContain('Сначала задайте процент');
  });

  it('ответ на порог при снятой настройке ничего не пишет', async () => {
    // Пока вопрос висел, бренд отключили: выдумывать настройку ради порога
    // нельзя — иначе продвижение включится само.
    const { handler, yandexMarketService, accessService } = await build({
      status: 'approved',
      store: { ...FULL },
      pendingRate: 'promo:casio:from',
    });
    const { allReplies } = await send(handler, '3000');

    expect(yandexMarketService.updatePromoCommission).not.toHaveBeenCalled();
    expect(accessService.setPendingRate).toHaveBeenCalledWith(String(USER_ID), '999', null);
    expect(allReplies()).toContain('не настроено');
  });

  it('«Отключить» снимает настройку бренда целиком', async () => {
    const { handler, yandexMarketService } = await build({
      status: 'approved',
      store: { ...FULL },
    });
    const { allReplies } = await tap(handler, 'promo:off:casio');

    expect(yandexMarketService.updatePromoCommission).toHaveBeenCalledWith(
      String(USER_ID),
      'casio',
      null,
    );
    expect(allReplies()).toContain('отключено');
  });

  it('промо-кнопка без магазина не открывает вопрос, а просит токен', async () => {
    const { handler, accessService } = await build({
      status: 'approved',
      store: null,
    });
    const { allReplies } = await tap(handler, 'promo:flat:casio');

    expect(accessService.setPendingRate).not.toHaveBeenCalled();
    expect(allReplies()).toContain('подключите магазин');
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
    const { handler, accessService, errors } = await build({
      listStoresError: new YandexNetworkError('ECONNRESET'),
    });
    const { reply } = await send(handler, FULL.token);

    expect(accessService.clearDraftField).not.toHaveBeenCalled();
    expect(reply()).toContain('Campaign ID');
    // Сбой автоопределения уходит и в панель, а не только в docker logs — иначе
    // причину (сеть/таймаут/лимит) не увидеть без доступа к контейнеру.
    expect(errors.report).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'onboarding:autofill', source: 'yandex' }),
    );
  });

  it('на шаге Campaign ID присланный ТОКЕН распознаётся и ведёт к списку магазинов', async () => {
    // Токен узнаётся по форме (буквы/двоеточие) и перебивает шаг: показать
    // магазины полезнее, чем ругать «это не число». Чистое число сюда не попало
    // бы — оно осталось бы Campaign ID'ом.
    const { handler } = await build({
      draft: { token: 'ACMA:old_token_value' }, // визард уже на шаге Campaign ID
      stores: [
        { campaignId: '1', businessId: '10', businessName: 'SBrand', storeName: 'SBrand' },
        { campaignId: '2', businessId: '10', businessName: 'SBrand', storeName: 'SBrand' },
      ] as never,
    });
    const { allReplies } = await send(handler, 'ACMA:0Cj6l6bNEWtoken:abcd');

    expect(allReplies()).toContain('Выберите магазин');
    expect(allReplies()).not.toContain('это число из 5');
  });

  it('на шаге Campaign ID число остаётся Campaign ID, а не принимается за токен', async () => {
    // Страховка: распознавание токена не должно сломать ручной ввод числа.
    const { handler } = await build({
      draft: { token: 'ACMA:old_token_value' },
      stores: [
        { campaignId: '9', businessId: '10', businessName: 'S', storeName: 's.ru' },
      ] as never,
    });
    const { allReplies } = await send(handler, '148704883');

    // Число приняли как Campaign ID (следующий шаг — Business ID), список не звали.
    expect(allReplies()).not.toContain('Выберите магазин');
    expect(allReplies()).toContain('Business ID');
  });

  it('несколько магазинов — показывается ТОЛЬКО пикер, без вопроса про Campaign ID', async () => {
    // Под списком «Выберите магазин» второй вопрос «введите Campaign ID» и
    // нелогичен, и противоречив: визард обязан остановиться и ждать нажатия.
    const { handler } = await build({
      stores: [
        { campaignId: '1', businessId: '10', businessName: 'SBrand', storeName: 'SBrand' },
        { campaignId: '2', businessId: '10', businessName: 'SBrand', storeName: 'SBrand' },
      ] as never,
    });
    const { allReplies } = await send(handler, FULL.token);

    expect(allReplies()).toContain('Выберите магазин');
    expect(allReplies()).not.toContain('Campaign ID');
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
