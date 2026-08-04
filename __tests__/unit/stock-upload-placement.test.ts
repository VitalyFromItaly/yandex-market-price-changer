import { describe, it, expect, vi, beforeEach } from 'vitest';

import { JOB_TYPES } from '../../src/modules/telegram/index';
import {
  StockUploadHandler,
  queueNote,
} from '../../src/modules/telegram/bots/price-changer-bot/handlers/stock-upload.handler';
import { FBY_STOCKS_READONLY } from '../../src/modules/yandex/stocks/placement';

/**
 * Ранний слой правила «на FBY остатки только читаются».
 *
 * Файл при этом ПРИНИМАЕТСЯ: из него сохраняются закупочные цены, без которых
 * «Прибыль» у FBY-продавца не считается вовсе (`PurchasePrice` ключуется по
 * продавцу, а не по магазину, так что одна загрузка обслуживает и FBS, и FBY).
 * Задача обработчика здесь — предупредить ДО постановки в очередь, а не
 * отказать: сказать «загружаю остатки» и через минуту прислать «остатки не
 * записаны» значит выглядеть сломанным.
 *
 * Сам обработчик файл больше НЕ обрабатывает — только проверяет и ставит
 * джобу sync-stocks (обработка в stock-sync.processor, вне цикла апдейтов
 * telegraf). Запрещает же запись всё равно `StockSyncService`
 * (см. stocks-sync.test.ts) — слоёв два, и перепутать, какой за что
 * отвечает, легко.
 */
describe('StockUploadHandler: модель размещения', () => {
  const FBS = { campaignId: '148655119', businessId: 'b', placementType: 'FBS' };
  const FBY = { campaignId: '148704883', businessId: 'b', placementType: 'FBY' };

  let placementFor: ReturnType<typeof vi.fn>;
  let findByTelegramUser: ReturnType<typeof vi.fn>;
  let findByUserAndBot: ReturnType<typeof vi.fn>;
  let queueAdd: ReturnType<typeof vi.fn>;
  let getWaitingCount: ReturnType<typeof vi.fn>;
  let getActiveCount: ReturnType<typeof vi.fn>;
  let handler: StockUploadHandler;

  const storeDoc = (campaignId: string, stores?: unknown[]) => ({
    campaign_id: campaignId,
    business_id: 'b',
    token: 'ACMA:x',
    stores,
  });

  /** Payload последней поставленной джобы. */
  const enqueued = () => queueAdd.mock.calls.at(-1)?.[1] as Record<string, unknown> | undefined;

  function buildHandler(isAdmin: boolean): StockUploadHandler {
    return new StockUploadHandler(
      { placementFor } as never,
      { findByTelegramUser } as never,
      { report: async () => undefined } as never,
      { replyNeedsStore: vi.fn(async () => undefined) } as never,
      { findByUserAndBot } as never,
      { isAdmin: () => isAdmin } as never,
      { add: queueAdd, getWaitingCount, getActiveCount } as never,
    );
  }

  beforeEach(() => {
    placementFor = vi.fn(async () => undefined);
    findByTelegramUser = vi.fn();
    // Записи доступа нет → у обеих фич прайса действует умолчание «включено».
    findByUserAndBot = vi.fn(async () => null);
    queueAdd = vi.fn(async () => ({ id: 1 }));
    getWaitingCount = vi.fn(async () => 0);
    getActiveCount = vi.fn(async () => 0);

    handler = buildHandler(false);
  });

  /** Достать обработчик документа, зарегистрированный через bot.on. */
  function documentHandler(): (ctx: unknown) => Promise<void> {
    let captured: ((ctx: unknown) => Promise<void>) | undefined;
    handler.register({ on: (_filter: unknown, fn: never) => (captured = fn) } as never);
    if (!captured) throw new Error('обработчик документа не зарегистрирован');
    return captured;
  }

  function ctxWith() {
    return {
      from: { id: 222 },
      botInfo: { id: 999 },
      chat: { id: 222 },
      message: { document: { file_id: 'f', file_name: 'stock.xlsx', file_size: 1024 } },
      reply: vi.fn(async () => undefined),
    };
  }

  /** Все реплаи одной строкой — предупреждение приходит не последним. */
  const said = (ctx: { reply: ReturnType<typeof vi.fn> }) =>
    ctx.reply.mock.calls.map((c) => String(c[0])).join('\n');

  it('FBY — файл ПРИНИМАЕТСЯ ради закупочных цен, но продавец предупреждён заранее', async () => {
    findByTelegramUser.mockResolvedValue(storeDoc(FBY.campaignId, [FBS, FBY]));
    const ctx = ctxWith();

    await documentHandler()(ctx as never);

    expect(said(ctx)).toContain('FBY');
    // Ради «Прибыли»: без этого закуп у FBY-продавца брать неоткуда.
    expect(queueAdd).toHaveBeenCalled();
  });

  it('джоба ставится с полным payload и attempts: 1', async () => {
    findByTelegramUser.mockResolvedValue(storeDoc(FBS.campaignId, [FBS, FBY]));

    await documentHandler()(ctxWith() as never);

    expect(queueAdd).toHaveBeenCalledWith(
      JOB_TYPES.SYNC_STOCKS,
      {
        botId: 999,
        chatId: '222',
        telegramUserId: '222',
        fileId: 'f',
        fileName: 'stock.xlsx',
        dryRun: false,
        savePurchasePrices: true,
        stockWriteAllowed: true,
      },
      // Дефолт очереди — attempts: 2; авто-повтор записи остатков жжёт
      // часовую квоту Partner API.
      { attempts: 1 },
    );
  });

  it('токен и креды в payload НЕ кладутся — их перечитает процессор', async () => {
    findByTelegramUser.mockResolvedValue(storeDoc(FBS.campaignId, [FBS, FBY]));

    await documentHandler()(ctxWith() as never);

    const payload = enqueued();
    expect(JSON.stringify(payload)).not.toContain('ACMA:x');
    expect(payload).not.toHaveProperty('token');
    expect(payload).not.toHaveProperty('campaignId');
  });

  it('на FBY бот не обещает загрузить остатки', async () => {
    // «Загружаю остатки», а следом отчёт «остатки не записаны» — это бот,
    // который сам себя опровергает.
    findByTelegramUser.mockResolvedValue(storeDoc(FBY.campaignId, [FBS, FBY]));
    const ctx = ctxWith();

    await documentHandler()(ctx as never);

    expect(said(ctx)).not.toContain('Загружаю остатки');
    expect(said(ctx)).toContain('остатки не трогаю');
  });

  it('предупреждение приходит ДО постановки в очередь', async () => {
    findByTelegramUser.mockResolvedValue(storeDoc(FBY.campaignId, [FBS, FBY]));
    const ctx = ctxWith();

    const order: string[] = [];
    ctx.reply.mockImplementation(async (text: string) => {
      order.push(String(text).includes('FBY') ? 'предупреждение' : 'прочее');
      return undefined;
    });
    queueAdd.mockImplementation(async () => {
      order.push('очередь');
      return { id: 1 };
    });

    await documentHandler()(ctx as never);

    expect(order.indexOf('предупреждение')).toBeLessThan(order.indexOf('очередь'));
  });

  it('FBS в кэше — работает как раньше', async () => {
    findByTelegramUser.mockResolvedValue(storeDoc(FBS.campaignId, [FBS, FBY]));

    await documentHandler()(ctxWith() as never);

    expect(queueAdd).toHaveBeenCalled();
  });

  it('кэш не знает модель — спрашиваем Маркет, и предупреждаем до очереди', async () => {
    // У продавца, подключившегося до появления кэша, модели в документе нет.
    findByTelegramUser.mockResolvedValue(storeDoc(FBY.campaignId, undefined));
    placementFor.mockResolvedValue('FBY');

    const ctx = ctxWith();
    await documentHandler()(ctx as never);

    expect(placementFor).toHaveBeenCalled();
    expect(said(ctx)).toContain('FBY');
    expect(queueAdd).toHaveBeenCalled();
  });

  it('кэш не знает, Маркет говорит FBS — работаем', async () => {
    findByTelegramUser.mockResolvedValue(storeDoc(FBS.campaignId, undefined));
    placementFor.mockResolvedValue('FBS');

    await documentHandler()(ctxWith() as never);

    expect(queueAdd).toHaveBeenCalled();
  });

  it('модель не определилась — предупреждаем, но не обвиняем в FBY', async () => {
    // Приписать продавцу FBY, когда просто не отвечает Маркет, значит отправить
    // его менять магазин, которого менять не надо.
    findByTelegramUser.mockResolvedValue(storeDoc(FBS.campaignId, undefined));
    placementFor.mockResolvedValue(undefined);

    const ctx = ctxWith();
    await documentHandler()(ctx as never);

    const text = said(ctx);
    expect(text).toContain('Не удалось определить модель');
    // FBY в тексте есть — как объяснение осторожности. Чего быть не должно, так
    // это совета сменить магазин: менять, возможно, нечего.
    expect(text).not.toContain('Сменить магазин');
    expect(text).not.toContain(FBY_STOCKS_READONLY);
    // Файл всё равно разбираем: закупочные цены нужны независимо от модели.
    expect(queueAdd).toHaveBeenCalled();
  });

  it('кэш знает модель — лишнего запроса к Маркету нет', async () => {
    // Типовой случай после смены магазина в боте: пикер сам работает из этого
    // кэша, значит модель заведомо известна и сеть не нужна.
    findByTelegramUser.mockResolvedValue(storeDoc(FBS.campaignId, [FBS, FBY]));

    await documentHandler()(ctxWith() as never);

    expect(placementFor).not.toHaveBeenCalled();
    expect(queueAdd).toHaveBeenCalled();
  });

  /**
   * Позиция в очереди. Типовой случай — очередь пуста, и упоминать её незачем;
   * но когда впереди чужие файлы, молчание читается как «бот завис».
   */
  describe('позиция в очереди', () => {
    it('очередь пуста — обычный текст без позиции', async () => {
      findByTelegramUser.mockResolvedValue(storeDoc(FBS.campaignId, [FBS, FBY]));
      const ctx = ctxWith();

      await documentHandler()(ctx as never);

      expect(said(ctx)).toContain('Загружаю остатки');
      expect(said(ctx)).not.toContain('Перед вами в очереди');
    });

    it('впереди файлы (waiting + active) — позиция в ответе', async () => {
      findByTelegramUser.mockResolvedValue(storeDoc(FBS.campaignId, [FBS, FBY]));
      getWaitingCount.mockResolvedValue(1);
      getActiveCount.mockResolvedValue(1);
      const ctx = ctxWith();

      await documentHandler()(ctx as never);

      expect(said(ctx)).toContain('Перед вами в очереди: 2 файла');
    });

    it('queueNote склоняет «файл» по-русски', () => {
      expect(queueNote(1)).toContain('1 файл —');
      expect(queueNote(3)).toContain('3 файла');
      expect(queueNote(5)).toContain('5 файлов');
      expect(queueNote(11)).toContain('11 файлов');
      expect(queueNote(21)).toContain('21 файл —');
      expect(queueNote(0)).toBe('');
    });
  });

  /**
   * Фичи прайса. Гейт документы не закрывает (исход бывает частичным), поэтому
   * решение по двум фичам — `purchase_prices` и `stock_update` — принимает сам
   * обработчик, до постановки в очередь.
   */
  describe('фичи прайса', () => {
    it('обе выключены — отказ до очереди', async () => {
      findByUserAndBot.mockResolvedValue({
        features: { purchase_prices: false, stock_update: false },
      });
      findByTelegramUser.mockResolvedValue(storeDoc(FBS.campaignId, [FBS, FBY]));

      const ctx = ctxWith();
      await documentHandler()(ctx as never);

      expect(said(ctx)).toContain('недоступна');
      expect(queueAdd).not.toHaveBeenCalled();
    });

    it('остатки выключены — джоба знает про запрет, Маркет о модели не спрашивается', async () => {
      findByUserAndBot.mockResolvedValue({ features: { stock_update: false } });
      findByTelegramUser.mockResolvedValue(storeDoc(FBS.campaignId, undefined));

      const ctx = ctxWith();
      await documentHandler()(ctx as never);

      expect(said(ctx)).toContain('отключена администратором');
      expect(said(ctx)).not.toContain('Загружаю остатки');
      // Раз писать не будем — модель не выясняем, тот же принцип, что у
      // STOCK_WRITE_ENABLED.
      expect(placementFor).not.toHaveBeenCalled();
      expect(enqueued()).toMatchObject({ stockWriteAllowed: false, savePurchasePrices: true });
    });

    it('закуп выключен — остатки пишутся, джоба цены не сохраняет', async () => {
      findByUserAndBot.mockResolvedValue({ features: { purchase_prices: false } });
      findByTelegramUser.mockResolvedValue(storeDoc(FBS.campaignId, [FBS, FBY]));

      const ctx = ctxWith();
      await documentHandler()(ctx as never);

      expect(said(ctx)).toContain('закупочные цены не сохраняю');
      expect(enqueued()).toMatchObject({ stockWriteAllowed: true, savePurchasePrices: false });
    });

    it('администратор минует обе фичи — как в featureGate', async () => {
      handler = buildHandler(true);
      findByTelegramUser.mockResolvedValue(storeDoc(FBS.campaignId, [FBS, FBY]));

      await documentHandler()(ctxWith() as never);

      // Запись доступа даже не читается — у админа её нет.
      expect(findByUserAndBot).not.toHaveBeenCalled();
      expect(enqueued()).toMatchObject({ stockWriteAllowed: true, savePurchasePrices: true });
    });

    it('FBY-магазин + выключенный закуп + без «проверки» — файлу нечего делать, отказ', async () => {
      findByUserAndBot.mockResolvedValue({ features: { purchase_prices: false } });
      findByTelegramUser.mockResolvedValue(storeDoc(FBY.campaignId, [FBS, FBY]));

      const ctx = ctxWith();
      await documentHandler()(ctx as never);

      expect(said(ctx)).toContain('недоступна');
      expect(queueAdd).not.toHaveBeenCalled();
    });
  });
});
