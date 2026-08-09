import type { YandexMarketDocument } from '../../../../../database/schemas/yandex-market.schema';
import type { IMarketReportParams } from '../../../../yandex/market-reports/market-reports.service';
import type { IMarketReportJob } from '../../../queue/processors/market-report.processor';

import { InjectQueue } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bull';
import { Context } from 'telegraf';

import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { ErrorReporter } from '../../../../errors/error-reporter.service';
import { MarketCategoriesService } from '../../../../yandex/market-reports/market-categories.service';
import {
  KEY_DETALIZATIONS,
  MARKET_REPORT_KEYS,
  MARKET_REPORT_META,
  MKT_CB_MENU,
  MKT_CB_PATTERN,
  mktCallback,
  mktMenuText,
  mktNoCategoriesText,
  mktOrderedText,
  mktQueuedAlreadyText,
  mktTurnoverFbyOnlyText,
  parseMktCallback,
  realizationMonths,
  SHOWS_GROUPINGS,
  type TMarketReportKey,
} from '../../../../yandex/market-reports/market-reports.domain';
import {
  PAYMENTS_PERIOD_LABELS,
  type TPaymentsPeriod,
} from '../../../../yandex/payments/payments.domain';
import { isFby, placementOfCampaign } from '../../../../yandex/stocks/placement';
import { StockSyncService } from '../../../../yandex/stocks/stock-sync.service';
import { TTelegrafBot } from '../../../domain.telegram';
import { htmlOptions } from '../../../formatting/telegram-format';
import { JOB_TYPES, QUEUE_NAMES } from '../../../index';
import { isQueuedFor } from '../../../queue/queued-for-user';
import { StorePromptService } from '../../shared/services/store-prompt.service';
import { PriceChangerKeyboard } from '../price-changer.keyboard';

/** Кнопочный ряд inline-клавиатуры. */
type TButtonRows = Array<Array<{ text: string; callback_data: string }>>;

/**
 * Раздел «📈 Отчёты Маркета»: кнопка меню → список из шести отчётов → короткая
 * цепочка пикеров кнопками → очередь → готовый xlsx Маркета.
 *
 * Один `bot.action(MKT_CB_PATTERN)` обслуживает весь раздел (паттерн
 * schedule.handler): конкретный отчёт и накопленные параметры едут в
 * callback_data, шаги перерисовываются editMessageText. pendingRate не
 * используется — все параметры дискретные.
 *
 * Сборка — в market-report.processor: generate→поллинг занимает минуты, а
 * ожидание в хендлере стопорило бы polling-цикл telegraf (довод платежей).
 */
@Injectable()
export class MarketReportsHandler {
  constructor(
    private readonly stores: YandexMarketService,
    private readonly keyboard: PriceChangerKeyboard,
    private readonly storePrompt: StorePromptService,
    private readonly categories: MarketCategoriesService,
    private readonly stockSync: StockSyncService,
    private readonly errors: ErrorReporter,
    @InjectQueue(QUEUE_NAMES.REPORTS) private readonly queue: Queue,
  ) {}

  /** Кнопка меню: показать список отчётов. */
  public async handle(ctx: Context): Promise<void> {
    try {
      const store = await this.stores.findByTelegramUser(ctx.from.id.toString());
      if (!store) {
        await this.storePrompt.replyNeedsStore(ctx);
        return;
      }
      await this.showMenu(ctx, store, false);
    } catch (error) {
      await this.replyWithError(ctx, error, 'раздел отчётов Маркета');
    }
  }

  /** Все кнопки раздела. Регистрируются ДО общего callback_query — композер. */
  public registerCallbacks(bot: TTelegrafBot): void {
    bot.action(MKT_CB_PATTERN, async (ctx) => {
      const data = (ctx.callbackQuery as { data?: string }).data;
      const parsed = parseMktCallback(data);
      await ctx.answerCbQuery();
      if (!parsed) return;

      try {
        const store = await this.stores.findByTelegramUser(ctx.from.id.toString());
        if (!store) {
          await this.storePrompt.replyNeedsStore(ctx);
          return;
        }

        if (parsed.key === 'menu') {
          await this.showMenu(ctx, store, true);
          return;
        }

        await this.step(ctx, store, parsed.key, parsed.args);
      } catch (error) {
        await this.replyWithError(ctx, error, 'отчёт Маркета');
      }
    });
  }

  /** Список отчётов. Оборачиваемость видна только FBY-магазину (кэш stores). */
  private async showMenu(ctx: Context, store: YandexMarketDocument, edit: boolean): Promise<void> {
    const placement = placementOfCampaign(store.stores, store.campaign_id);

    const rows: TButtonRows = MARKET_REPORT_KEYS.filter(
      (key) => !MARKET_REPORT_META[key].fbyOnly || isFby(placement),
    ).map((key) => [
      {
        text: `${MARKET_REPORT_META[key].emoji} ${MARKET_REPORT_META[key].title}`,
        callback_data: mktCallback(key),
      },
    ]);

    await this.render(ctx, mktMenuText(), rows, edit);
  }

  /**
   * Один шаг цепочки конкретного отчёта. Хвост args накапливает уже выбранные
   * параметры; терминальный шаг ставит джобу.
   */
  private async step(
    ctx: Context,
    store: YandexMarketDocument,
    key: TMarketReportKey,
    args: string[],
  ): Promise<void> {
    switch (key) {
      case 'real':
        await this.stepRealization(ctx, store, args);
        return;
      case 'turn':
        await this.stepTurnover(ctx, store);
        return;
      case 'comp':
        await this.stepCompetitors(ctx, store, args);
        return;
      case 'shows':
        await this.stepShowsSales(ctx, store, args);
        return;
      case 'key':
        await this.stepKeyIndicators(ctx, store, args);
        return;
      case 'geo':
        await this.stepGeography(ctx, store, args);
        return;
    }
  }

  /** Реализация: выбор завершённого месяца → джоба. */
  private async stepRealization(
    ctx: Context,
    store: YandexMarketDocument,
    args: string[],
  ): Promise<void> {
    if (args.length >= 2) {
      const year = Number(args[0]);
      const month = Number(args[1]);
      if (!Number.isInteger(year) || !Number.isInteger(month)) return;
      await this.enqueue(ctx, 'real', { year, month });
      return;
    }

    const rows: TButtonRows = realizationMonths().map((m) => [
      { text: m.label, callback_data: mktCallback('real', m.year, m.month) },
    ]);
    rows.push(this.backRow());

    await this.render(ctx, '🧾 Реализация — за какой месяц?', rows, true);
  }

  /** Оборачиваемость: параметров нет, но экран только для FBY. */
  private async stepTurnover(ctx: Context, store: YandexMarketDocument): Promise<void> {
    // Кэш → живой listStores: не отказывать несправедливо (паттерн FbyHandler).
    const placement =
      placementOfCampaign(store.stores, store.campaign_id) ??
      (await this.stockSync.placementFor({
        token: store.token,
        campaignId: store.campaign_id,
        businessId: store.business_id,
      }));

    if (!isFby(placement)) {
      await ctx.reply(mktTurnoverFbyOnlyText(), htmlOptions());
      return;
    }

    await this.enqueue(ctx, 'turn', {});
  }

  /** Конкуренты: категория → период → джоба. */
  private async stepCompetitors(
    ctx: Context,
    store: YandexMarketDocument,
    args: string[],
  ): Promise<void> {
    if (args.length >= 2) {
      const categoryId = Number(args[0]);
      const periodKey = this.periodOf(args[1]);
      if (!Number.isInteger(categoryId) || !periodKey) return;
      await this.enqueue(ctx, 'comp', { categoryId, periodKey });
      return;
    }

    if (args.length === 1) {
      const categoryId = Number(args[0]);
      if (!Number.isInteger(categoryId)) return;
      await this.askPeriod(ctx, '🥇 Конкурентная позиция — за какой период?', (period) =>
        mktCallback('comp', categoryId, period),
      );
      return;
    }

    // Обход каталога — секунды; экран честно говорит, что занят.
    await this.render(ctx, '⏳ Загружаю категории каталога…', [], true);

    const categories = await this.categories.topCategories(store);
    if (!categories.length) {
      await this.render(ctx, mktNoCategoriesText(), [this.backRow()], true);
      return;
    }

    const rows: TButtonRows = categories.map((category) => [
      {
        text: `${category.name} (${category.offers})`,
        callback_data: mktCallback('comp', category.categoryId),
      },
    ]);
    rows.push(this.backRow());

    await this.render(ctx, '🥇 Конкурентная позиция — по какой категории?', rows, true);
  }

  /** Аналитика продаж: период → группировка → джоба. */
  private async stepShowsSales(
    ctx: Context,
    store: YandexMarketDocument,
    args: string[],
  ): Promise<void> {
    if (args.length >= 2) {
      const periodKey = this.periodOf(args[0]);
      const grouping = SHOWS_GROUPINGS.find((g) => g.short === args[1]);
      if (!periodKey || !grouping) return;
      await this.enqueue(ctx, 'shows', { periodKey, grouping: grouping.code });
      return;
    }

    if (args.length === 1) {
      const periodKey = this.periodOf(args[0]);
      if (!periodKey) return;
      const rows: TButtonRows = SHOWS_GROUPINGS.map((g) => [
        { text: g.label, callback_data: mktCallback('shows', periodKey, g.short) },
      ]);
      rows.push(this.backRow());
      await this.render(ctx, '📊 Аналитика продаж — как сгруппировать?', rows, true);
      return;
    }

    await this.askPeriod(ctx, '📊 Аналитика продаж — за какой период?', (period) =>
      mktCallback('shows', period),
    );
  }

  /** Ключевые показатели: только детализация. */
  private async stepKeyIndicators(
    ctx: Context,
    store: YandexMarketDocument,
    args: string[],
  ): Promise<void> {
    if (args.length >= 1) {
      const detalization = KEY_DETALIZATIONS.find((d) => d.short === args[0]);
      if (!detalization) return;
      await this.enqueue(ctx, 'key', { detalizationLevel: detalization.code });
      return;
    }

    const rows: TButtonRows = KEY_DETALIZATIONS.map((d) => [
      { text: d.label, callback_data: mktCallback('key', d.short) },
    ]);
    rows.push(this.backRow());
    await this.render(ctx, '📌 Ключевые показатели — с какой детализацией?', rows, true);
  }

  /** География: только период. */
  private async stepGeography(
    ctx: Context,
    store: YandexMarketDocument,
    args: string[],
  ): Promise<void> {
    if (args.length >= 1) {
      const periodKey = this.periodOf(args[0]);
      if (!periodKey) return;
      await this.enqueue(ctx, 'geo', { periodKey });
      return;
    }

    await this.askPeriod(ctx, '🗺 География продаж — за какой период?', (period) =>
      mktCallback('geo', period),
    );
  }

  /** Пикер периода — общие пресеты платежей (week/month/prevmonth). */
  private async askPeriod(
    ctx: Context,
    question: string,
    callbackOf: (period: TPaymentsPeriod) => string,
  ): Promise<void> {
    const rows: TButtonRows = (Object.keys(PAYMENTS_PERIOD_LABELS) as TPaymentsPeriod[]).map(
      (period) => [{ text: PAYMENTS_PERIOD_LABELS[period], callback_data: callbackOf(period) }],
    );
    rows.push(this.backRow());

    await this.render(ctx, question, rows, true);
  }

  /** Терминальный шаг: дедуп по очереди → джоба → «заказал». */
  private async enqueue(
    ctx: Context,
    key: TMarketReportKey,
    params: IMarketReportParams,
  ): Promise<void> {
    const telegramUserId = ctx.from.id.toString();

    // Защёлка грубая — один отчёт Маркета за раз на продавца: параметры не
    // сравниваем, «уже собирается» честнее гонки двух generate.
    const jobs = await this.queue.getJobs(['waiting', 'active']);
    if (isQueuedFor(jobs, JOB_TYPES.SEND_MARKET_REPORT, telegramUserId)) {
      await ctx.reply(mktQueuedAlreadyText());
      return;
    }

    const payload: IMarketReportJob = {
      botId: ctx.botInfo.id,
      chatId: ctx.chat.id.toString(),
      telegramUserId,
      report: key,
      params,
    };
    await this.queue.add(JOB_TYPES.SEND_MARKET_REPORT, payload);

    await ctx.reply(mktOrderedText(key));
  }

  /** Ряд «⬅️ Назад к списку». */
  private backRow(): Array<{ text: string; callback_data: string }> {
    return [{ text: '⬅️ К списку отчётов', callback_data: MKT_CB_MENU }];
  }

  private periodOf(value: string): TPaymentsPeriod | null {
    return Object.prototype.hasOwnProperty.call(PAYMENTS_PERIOD_LABELS, value)
      ? (value as TPaymentsPeriod)
      : null;
  }

  /**
   * Отрисовка шага: из кнопки меню — reply, из inline-шага — editMessageText
   * (перерисовка на месте, паттерн schedule.handler; «message is not modified»
   * гасится).
   */
  private async render(
    ctx: Context,
    text: string,
    rows: TButtonRows,
    edit: boolean,
  ): Promise<void> {
    const keyboard = await this.keyboard.createInlineKeyboardMatrix(rows);
    const options = htmlOptions({ reply_markup: keyboard.reply_markup });

    if (edit) {
      try {
        await ctx.editMessageText(text, options);
        return;
      } catch {
        // Сообщение не изменилось или слишком старое — шлём новое ниже.
      }
    }
    await ctx.reply(text, options);
  }

  private async replyWithError(ctx: Context, error: unknown, action: string): Promise<void> {
    void this.errors.report({
      error,
      source: 'bot',
      context: 'market-reports',
      telegramUserId: ctx.from?.id?.toString(),
      username: ctx.from?.username,
      chatId: ctx.chat?.id?.toString(),
      botId: ctx.botInfo?.id?.toString(),
      action,
    });

    await ctx.reply('❌ Не удалось открыть раздел отчётов. Попробуйте позже.', htmlOptions());
  }
}
