import type { IFbyOverviewJob } from '../../../queue/processors/fby-overview.processor';

import { InjectQueue } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bull';
import { Context } from 'telegraf';

import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { fbyOverviewErrorText } from '../../../../../modules/yandex/fby/fby-message';
import {
  fbyOnlyScreenText,
  isFby,
  placementOfCampaign,
} from '../../../../../modules/yandex/stocks/placement';
import { StockSyncService } from '../../../../../modules/yandex/stocks/stock-sync.service';
import { ErrorReporter } from '../../../../errors/error-reporter.service';
import { htmlOptions } from '../../../formatting/telegram-format';
import { JOB_TYPES, QUEUE_NAMES } from '../../../index';
import { isQueuedFor } from '../../../queue/queued-for-user';
import { StorePromptService } from '../../shared/services/store-prompt.service';

/**
 * Сводка FBY одним экраном: остатки по типам, проблемные позиции, заявки на
 * вывоз/утилизацию, «едет до клиента»/«едет обратно».
 *
 * Зовётся из кнопки меню «📦 FBY» через MenuCommandsHandler — как обзор складов
 * через WarehousesHandler, поэтому в пайплайн composer'а отдельным шагом не
 * встаёт. Доступ закрыт фичей `fby` (по умолчанию выключена): гейт возможностей
 * отбивает кнопку раньше этого хендлера, свободного текста у сводки нет —
 * перепроверять флаг здесь не нужно. Модель магазина — нужно: экран живёт
 * только у FBY, а гейт про магазины ничего не знает.
 *
 * Сборка — в fby-overview.processor.ts, хендлер только проверяет и ставит
 * джобу. Причина та же, что у загрузки прайса: остатки FBY приходят из
 * асинхронного отчёта Маркета (generate → поллинг, минуты), а polling-цикл
 * telegraf не забирает новые апдейты, пока не завершены все текущие, — то есть
 * ожидание в хендлере останавливало бота для ВСЕХ.
 */
@Injectable()
export class FbyHandler {
  constructor(
    private readonly stores: YandexMarketService,
    private readonly errors: ErrorReporter,
    private readonly storePrompt: StorePromptService,
    private readonly stockSync: StockSyncService,
    @InjectQueue(QUEUE_NAMES.REPORTS) private readonly queue: Queue,
  ) {}

  public async handle(ctx: Context): Promise<void> {
    try {
      // Защёлка «уже собирается» — по очереди, а не в памяти процесса: см.
      // isQueuedFor.
      if (await this.alreadyQueued(ctx.from.id.toString())) {
        await ctx.reply('⏳ Сводка FBY уже собирается, подождите немного.');
        return;
      }

      const store = await this.stores.findByTelegramUser(ctx.from.id.toString());
      if (!store) {
        await this.storePrompt.replyNeedsStore(ctx);
        return;
      }

      // Сводка — про склад Маркета, не-FBY магазину показывать нечего. Кнопку
      // из меню на не-FBY уже вырезала раскладка, но подпись можно набрать
      // текстом. Сначала кэш `stores` (обычный случай — без единого запроса),
      // при пустом кэше — живой listStores, чтобы не отказывать несправедливо.
      const placement =
        placementOfCampaign(store.stores, store.campaign_id) ??
        (await this.stockSync.placementFor({
          token: store.token,
          campaignId: store.campaign_id,
          businessId: store.business_id,
        }));
      if (!isFby(placement)) {
        await ctx.reply(fbyOnlyScreenText(placement), htmlOptions());
        return;
      }

      const payload: IFbyOverviewJob = {
        botId: ctx.botInfo.id,
        chatId: ctx.chat.id.toString(),
        telegramUserId: ctx.from.id.toString(),
      };
      await this.queue.add(JOB_TYPES.SEND_FBY_OVERVIEW, payload);

      await ctx.reply('⏳ Собираю сводку FBY, пришлю, как будет готова…');
    } catch (error) {
      await this.replyWithError(ctx, error);
    }
  }

  /** Есть ли у продавца живая джоба сводки — ждущая или уже в работе. */
  private async alreadyQueued(telegramUserId: string): Promise<boolean> {
    const jobs = await this.queue.getJobs(['waiting', 'active']);
    return isQueuedFor(jobs, JOB_TYPES.SEND_FBY_OVERVIEW, telegramUserId);
  }

  private async replyWithError(ctx: Context, error: unknown): Promise<void> {
    void this.errors.report({
      error,
      source: 'bot',
      context: 'fby',
      telegramUserId: ctx.from?.id?.toString(),
      username: ctx.from?.username,
      chatId: ctx.chat?.id?.toString(),
      botId: ctx.botInfo?.id?.toString(),
      action: 'сводка FBY',
    });

    await ctx.reply(fbyOverviewErrorText(error), htmlOptions());
  }
}
