import type { IPaymentsReportJob } from '../../../queue/processors/payments-report.processor';

import { InjectQueue } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bull';
import { Context } from 'telegraf';

import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { ErrorReporter } from '../../../../errors/error-reporter.service';
import {
  PAY_CB_PATTERN,
  PAYMENTS_PERIOD_LABELS,
  parsePayCallback,
  payCallback,
  paymentsAskPeriodText,
  paymentsErrorText,
  paymentsOrderedText,
  paymentsQueuedAlreadyText,
  type TPaymentsPeriod,
} from '../../../../yandex/payments/payments.domain';
import { TTelegrafBot } from '../../../domain.telegram';
import { htmlOptions } from '../../../formatting/telegram-format';
import { JOB_TYPES, QUEUE_NAMES } from '../../../index';
import { isQueuedFor } from '../../../queue/queued-for-user';
import { StorePromptService } from '../../shared/services/store-prompt.service';
import { PriceChangerKeyboard } from '../price-changer.keyboard';

/**
 * Экран «💳 Платежи»: отчёт по фактическим перечислениям Маркета
 * (united-netting) xlsx-файлом.
 *
 * Хендлер только спрашивает период и ставит джобу — generate→поллинг занимает
 * минуты и живёт в payments-report.processor (довод fby-overview). Payload —
 * botId/chatId/период, БЕЗ токена: креды процессор перечитывает из Mongo.
 */
@Injectable()
export class PaymentsHandler {
  constructor(
    private readonly stores: YandexMarketService,
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

      const rows = (Object.keys(PAYMENTS_PERIOD_LABELS) as TPaymentsPeriod[]).map((period) => [
        { text: PAYMENTS_PERIOD_LABELS[period], callback_data: payCallback(period) },
      ]);
      const keyboard = await this.keyboard.createInlineKeyboardMatrix(rows);

      await ctx.reply(
        paymentsAskPeriodText(),
        htmlOptions({ reply_markup: keyboard.reply_markup }),
      );
    } catch (error) {
      await this.replyWithError(ctx, error);
    }
  }

  /** Кнопки периода. Регистрируются ДО общего callback_query — см. композер. */
  public registerCallbacks(bot: TTelegrafBot): void {
    bot.action(PAY_CB_PATTERN, async (ctx) => {
      const data = (ctx.callbackQuery as { data?: string }).data;
      const period = parsePayCallback(data);
      await ctx.answerCbQuery();
      if (!period) return;

      try {
        await this.enqueue(ctx, period);
      } catch (error) {
        await this.replyWithError(ctx, error);
      }
    });
  }

  private async enqueue(ctx: Context, period: TPaymentsPeriod): Promise<void> {
    const telegramUserId = ctx.from.id.toString();

    // Защёлка — по очереди, не в памяти: см. queued-for-user.
    const jobs = await this.queue.getJobs(['waiting', 'active']);
    if (isQueuedFor(jobs, JOB_TYPES.SEND_PAYMENTS_REPORT, telegramUserId)) {
      await ctx.reply(paymentsQueuedAlreadyText());
      return;
    }

    const store = await this.stores.findByTelegramUser(telegramUserId);
    if (!store) {
      await this.storePrompt.replyNeedsStore(ctx);
      return;
    }

    const payload: IPaymentsReportJob = {
      botId: ctx.botInfo.id,
      chatId: ctx.chat.id.toString(),
      telegramUserId,
      period,
    };
    await this.queue.add(JOB_TYPES.SEND_PAYMENTS_REPORT, payload);

    await ctx.reply(paymentsOrderedText());
  }

  private async replyWithError(ctx: Context, error: unknown): Promise<void> {
    void this.errors.report({
      error,
      source: 'bot',
      context: 'payments',
      telegramUserId: ctx.from?.id?.toString(),
      username: ctx.from?.username,
      chatId: ctx.chat?.id?.toString(),
      botId: ctx.botInfo?.id?.toString(),
      action: 'отчёт по платежам',
    });

    await ctx.reply(paymentsErrorText(), htmlOptions());
  }
}
