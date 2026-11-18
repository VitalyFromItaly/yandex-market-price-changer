import type { IReportPeriod, TPeriodKey } from '../../../../yandex/reports/report-period';
import type { ITopSkusReportJob } from '../../../queue/processors/top-skus-report.processor';

import { InjectQueue } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bull';
import { Context } from 'telegraf';

import { UserAccessService } from '../../../../../database/services/user-access.service';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { ErrorReporter } from '../../../../errors/error-reporter.service';
import { reportErrorText } from '../../../../yandex/reports/report-message';
import {
  PERIOD,
  assertPeriodOrdered,
  parseRangeInput,
} from '../../../../yandex/reports/report-period';
import {
  TOP_CB_PATTERN,
  TOP_SKUS_BAD_RANGE_TEXT,
  TOP_SKUS_LOCKED_TEXT,
  TOP_SKUS_PENDING,
  TOP_SKUS_QUEUED_TEXT,
  parseTopCallback,
  topCallback,
  topSkusAskPeriodText,
  topSkusAskRangeText,
  topSkusPeriodButtonLabel,
  topSkusPeriods,
} from '../../../../yandex/top-skus/top-skus.domain';
import { YandexDateRangeError } from '../../../../yandex/yandex-date-window';
import { TTelegrafBot } from '../../../domain.telegram';
import { esc, htmlOptions } from '../../../formatting/telegram-format';
import { JOB_TYPES, QUEUE_NAMES } from '../../../index';
import { isQueuedFor } from '../../../queue/queued-for-user';
import { FEATURE, isFeatureEnabled } from '../../shared/features.domain';
import { StorePromptService } from '../../shared/services/store-prompt.service';
import { PriceChangerKeyboard } from '../price-changer.keyboard';

/**
 * Экран «🏆 Топ товаров» (под `report_profit`, своего флага нет): все проданные товары за период сообщением и xlsx.
 *
 * Хендлер только спрашивает период и ставит джобу — сборка та же, что у «Прибыли», и
 * живёт в TopSkusReportProcessor. «Свой период» спрашивается текстом: незакрытый вопрос
 * лежит в `UserAccess.pendingReportDay` меткой `TOP_SKUS_PENDING` (поле общее с «Другим
 * днём» отчётов, поэтому `handlePendingRange` зовётся ДО `ReportsHandler.handlePendingDay`).
 */
@Injectable()
export class TopSkusHandler {
  constructor(
    private readonly stores: YandexMarketService,
    private readonly access: UserAccessService,
    private readonly keyboard: PriceChangerKeyboard,
    private readonly storePrompt: StorePromptService,
    private readonly errors: ErrorReporter,
    @InjectQueue(QUEUE_NAMES.REPORTS) private readonly queue: Queue,
  ) {}

  /** Кнопка меню: спросить период. */
  public async handle(ctx: Context): Promise<void> {
    try {
      const store = await this.stores.findByTelegramUser(ctx.from.id.toString());
      if (!store) {
        await this.storePrompt.replyNeedsStore(ctx);
        return;
      }
      const account = await this.account(ctx);
      // «Прошлый месяц» почти всегда старше 30 дней — только с архивом.
      const prevMonth = account ? isFeatureEnabled(account.features, FEATURE.DEEP_HISTORY) : true;
      const rows = topSkusPeriods({ prevMonth }).map((row) =>
        row.map((period) => ({
          text: topSkusPeriodButtonLabel(period),
          callback_data: topCallback(period),
        })),
      );
      const keyboard = await this.keyboard.createInlineKeyboardMatrix(rows);
      await ctx.reply(topSkusAskPeriodText(), htmlOptions({ reply_markup: keyboard.reply_markup }));
    } catch (error) {
      await this.replyWithError(ctx, error);
    }
  }

  /** Кнопки периода. Регистрируются ДО общего callback_query — см. композер. */
  public registerCallbacks(bot: TTelegrafBot): void {
    bot.action(TOP_CB_PATTERN, async (ctx) => {
      const data = (ctx.callbackQuery as { data?: string }).data;
      const period = parseTopCallback(data);
      await ctx.answerCbQuery();
      if (!period) return;

      try {
        if (period === PERIOD.RANGE) {
          await this.askRange(ctx);
          return;
        }
        await this.enqueue(ctx, { key: period as TPeriodKey });
      } catch (error) {
        await this.replyWithError(ctx, error);
      }
    });
  }

  private async askRange(ctx: Context): Promise<void> {
    const account = await this.account(ctx);
    await this.access.setPendingReportDay(
      ctx.from.id.toString(),
      ctx.botInfo.id.toString(),
      TOP_SKUS_PENDING,
    );
    const deepHistory = account ? isFeatureEnabled(account.features, FEATURE.DEEP_HISTORY) : true;
    await ctx.reply(topSkusAskRangeText(deepHistory), htmlOptions());
  }

  /**
   * Присланный «свой период». Зовётся из обработчика текста ДО «Другого дня» отчётов.
   *
   * @returns true, если вопрос был наш и сообщение обработано здесь.
   */
  public async handlePendingRange(ctx: Context, text: string): Promise<boolean> {
    const account = await this.account(ctx);
    if (account?.pendingReportDay !== TOP_SKUS_PENDING) return false;

    const range = parseRangeInput(text);
    if (!range) {
      // Вопрос остаётся открытым: ответить можно ещё раз, не начиная заново.
      await ctx.reply(TOP_SKUS_BAD_RANGE_TEXT, htmlOptions());
      return true;
    }

    const period: IReportPeriod = { key: PERIOD.RANGE, from: range.from, to: range.to };
    try {
      assertPeriodOrdered(period);
    } catch (error) {
      if (!(error instanceof YandexDateRangeError)) throw error;
      await ctx.reply(`❌ ${esc(error.userMessage)}`, htmlOptions());
      return true;
    }

    await this.access.setPendingReportDay(ctx.from.id.toString(), ctx.botInfo.id.toString(), null);
    try {
      await this.enqueue(ctx, period);
    } catch (error) {
      await this.replyWithError(ctx, error);
    }
    return true;
  }

  private async enqueue(ctx: Context, period: IReportPeriod): Promise<void> {
    const telegramUserId = ctx.from.id.toString();

    // Перепроверка фичи: гейт ловит кнопку, но не ответ ТЕКСТОМ на «свой период».
    const account = await this.account(ctx);
    if (account && !isFeatureEnabled(account.features, FEATURE.REPORT_PROFIT)) {
      await ctx.reply(TOP_SKUS_LOCKED_TEXT, htmlOptions());
      return;
    }

    // Защёлка — по очереди, не в памяти: см. queued-for-user.
    const jobs = await this.queue.getJobs(['waiting', 'active']);
    if (isQueuedFor(jobs, JOB_TYPES.SEND_TOP_SKUS_REPORT, telegramUserId)) {
      await ctx.reply('⏳ Топ товаров уже собирается, подождите немного.');
      return;
    }

    const store = await this.stores.findByTelegramUser(telegramUserId);
    if (!store) {
      await this.storePrompt.replyNeedsStore(ctx);
      return;
    }

    // Флаги решаются здесь: нет записи доступа — админ, у него открыто всё.
    const payload: ITopSkusReportJob = {
      botId: ctx.botInfo.id,
      chatId: ctx.chat.id.toString(),
      telegramUserId,
      period,
      deepHistory: account ? isFeatureEnabled(account.features, FEATURE.DEEP_HISTORY) : true,
      places: true,
    };
    await this.queue.add(JOB_TYPES.SEND_TOP_SKUS_REPORT, payload);
    await ctx.reply(TOP_SKUS_QUEUED_TEXT);
  }

  private async account(ctx: Context) {
    return await this.access.findByUserAndBot(ctx.from.id.toString(), ctx.botInfo.id.toString());
  }

  private async replyWithError(ctx: Context, error: unknown): Promise<void> {
    void this.errors.report({
      error,
      source: 'bot',
      context: 'top-skus',
      telegramUserId: ctx.from?.id?.toString(),
      username: ctx.from?.username,
      chatId: ctx.chat?.id?.toString(),
      botId: ctx.botInfo?.id?.toString(),
      action: 'отчёт «Топ товаров»',
    });
    await ctx.reply(reportErrorText(error), htmlOptions());
  }
}
