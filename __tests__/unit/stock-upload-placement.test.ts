import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { StockUploadHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/stock-upload.handler';
import { FBY_STOCKS_READONLY } from '../../src/modules/yandex/stocks/placement';

/**
 * Ранний слой правила «на FBY остатки только читаются».
 *
 * Файл при этом ПРИНИМАЕТСЯ: из него сохраняются закупочные цены, без которых
 * «Прибыль» у FBY-продавца не считается вовсе (`PurchasePrice` ключуется по
 * продавцу, а не по магазину, так что одна загрузка обслуживает и FBS, и FBY).
 * Задача обработчика здесь — предупредить ДО скачивания, а не отказать: сказать
 * «загружаю остатки» и через минуту прислать «остатки не записаны» значит
 * выглядеть сломанным.
 *
 * Запрещает же всё равно `StockSyncService` (см. stocks-sync.test.ts) — слоёв
 * два, и перепутать, какой за что отвечает, легко.
 */
describe('StockUploadHandler: модель размещения', () => {
  const FBS = { campaignId: '148655119', businessId: 'b', placementType: 'FBS' };
  const FBY = { campaignId: '148704883', businessId: 'b', placementType: 'FBY' };

  let sync: ReturnType<typeof vi.fn>;
  let placementFor: ReturnType<typeof vi.fn>;
  let findByTelegramUser: ReturnType<typeof vi.fn>;
  let getFileLink: ReturnType<typeof vi.fn>;
  let handler: StockUploadHandler;

  const storeDoc = (campaignId: string, stores?: unknown[]) => ({
    campaign_id: campaignId,
    business_id: 'b',
    token: 'ACMA:x',
    stores,
  });

  beforeEach(() => {
    sync = vi.fn(async () => ({
      totalRows: 1,
      matched: 1,
      zeroed: 0,
      updated: 1,
      skipped: [],
      matchedBy: {},
      errors: [],
      dryRun: false,
      catalogSize: 1,
      purchasePricesSaved: 1,
      writeSkipReason: undefined,
    }));
    placementFor = vi.fn(async () => undefined);
    findByTelegramUser = vi.fn();
    getFileLink = vi.fn(async () => ({ href: 'https://example.invalid/file.xlsx' }));

    // Скачивание файла — обычный fetch. В сеть за ним не ходим: тест про то,
    // ДОШЛИ ли до скачивания, а не про сам файл.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })),
    );

    handler = new StockUploadHandler(
      { sync, placementFor } as never,
      { findByTelegramUser } as never,
      { report: async () => undefined } as never,
      { replyNeedsStore: vi.fn(async () => undefined) } as never,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
      telegram: { getFileLink },
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
    expect(sync).toHaveBeenCalled();
    expect(getFileLink).toHaveBeenCalled();
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

  it('предупреждение приходит ДО скачивания файла', async () => {
    findByTelegramUser.mockResolvedValue(storeDoc(FBY.campaignId, [FBS, FBY]));
    const ctx = ctxWith();

    const order: string[] = [];
    ctx.reply.mockImplementation(async (text: string) => {
      order.push(String(text).includes('FBY') ? 'предупреждение' : 'прочее');
      return undefined;
    });
    getFileLink.mockImplementation(async () => {
      order.push('скачивание');
      return { href: 'https://example.invalid/file.xlsx' };
    });

    await documentHandler()(ctx as never);

    expect(order.indexOf('предупреждение')).toBeLessThan(order.indexOf('скачивание'));
  });

  it('FBS в кэше — работает как раньше', async () => {
    findByTelegramUser.mockResolvedValue(storeDoc(FBS.campaignId, [FBS, FBY]));

    await documentHandler()(ctxWith() as never);

    expect(getFileLink).toHaveBeenCalled();
    expect(sync).toHaveBeenCalled();
  });

  it('кэш не знает модель — спрашиваем Маркет, и предупреждаем до скачивания', async () => {
    // У продавца, подключившегося до появления кэша, модели в документе нет.
    findByTelegramUser.mockResolvedValue(storeDoc(FBY.campaignId, undefined));
    placementFor.mockResolvedValue('FBY');

    const ctx = ctxWith();
    await documentHandler()(ctx as never);

    expect(placementFor).toHaveBeenCalled();
    expect(said(ctx)).toContain('FBY');
    expect(sync).toHaveBeenCalled();
  });

  it('кэш не знает, Маркет говорит FBS — работаем', async () => {
    findByTelegramUser.mockResolvedValue(storeDoc(FBS.campaignId, undefined));
    placementFor.mockResolvedValue('FBS');

    await documentHandler()(ctxWith() as never);

    expect(sync).toHaveBeenCalled();
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
    expect(sync).toHaveBeenCalled();
  });

  it('кэш знает модель — лишнего запроса к Маркету нет', async () => {
    // Типовой случай после смены магазина в боте: пикер сам работает из этого
    // кэша, значит модель заведомо известна и сеть не нужна.
    findByTelegramUser.mockResolvedValue(storeDoc(FBS.campaignId, [FBS, FBY]));

    await documentHandler()(ctxWith() as never);

    expect(placementFor).not.toHaveBeenCalled();
    expect(sync).toHaveBeenCalled();
  });
});
