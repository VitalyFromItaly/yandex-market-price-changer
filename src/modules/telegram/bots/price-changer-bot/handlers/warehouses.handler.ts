import type { IWarehousesOverviewJob } from '../../../queue/processors/warehouses-overview.processor';

import { InjectQueue } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bull';
import { Context } from 'telegraf';

import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import {
  fbyOnlyScreenText,
  isFby,
  placementOfCampaign,
} from '../../../../../modules/yandex/stocks/placement';
import { StockSyncService } from '../../../../../modules/yandex/stocks/stock-sync.service';
import { warehousesErrorText } from '../../../../../modules/yandex/warehouses/warehouses-message';
import { ErrorReporter } from '../../../../errors/error-reporter.service';
import { htmlOptions } from '../../../formatting/telegram-format';
import { JOB_TYPES, QUEUE_NAMES } from '../../../index';
import { isQueuedFor } from '../../../queue/queued-for-user';
import { StorePromptService } from '../../shared/services/store-prompt.service';

/**
 * Обзор складов продавца по типам (FBY и склад магазина) с остатками на каждом
 * складе Маркета.
 *
 * Зовётся из кнопки меню «🏬 Склады» через MenuCommandsHandler — как отчёты
 * через ReportsHandler, поэтому в пайплайн composer'а отдельным шагом не
 * встаёт. Доступ закрыт фичей `warehouses` (по умолчанию выключена): гейт
 * возможностей отбивает кнопку раньше этого хендлера, свободного текста у
 * обзора нет, так что перепроверять флаг здесь не нужно. Модель магазина —
 * нужно: экран живёт только у FBY, а гейт про магазины ничего не знает.
 *
 * Сборка — в warehouses-overview.processor.ts, хендлер только проверяет и
 * ставит джобу. Причина та же, что у сводки FBY: остатки по складам приходят
 * из асинхронного отчёта Маркета (generate → поллинг, минуты), а polling-цикл
 * telegraf не забирает новые апдейты, пока не завершены все текущие, — то есть
 * ожидание в хендлере останавливало бы бота для ВСЕХ.
 *
 * Запрос к Partner API — только чтение, никакой записи.
 */
@Injectable()
export class WarehousesHandler {
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
      const jobs = await this.queue.getJobs(['waiting', 'active']);
      if (isQueuedFor(jobs, JOB_TYPES.SEND_WAREHOUSES_OVERVIEW, ctx.from.id.toString())) {
        await ctx.reply('⏳ Список складов уже собирается, подождите немного.');
        return;
      }

      const store = await this.stores.findByTelegramUser(ctx.from.id.toString());
      if (!store) {
        await this.storePrompt.replyNeedsStore(ctx);
        return;
      }

      // Экран — про склад Маркета, не-FBY магазину показывать нечего. Кнопку
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

      const payload: IWarehousesOverviewJob = {
        botId: ctx.botInfo.id,
        chatId: ctx.chat.id.toString(),
        telegramUserId: ctx.from.id.toString(),
      };
      await this.queue.add(JOB_TYPES.SEND_WAREHOUSES_OVERVIEW, payload);

      await ctx.reply('⏳ Собираю склады с остатками, пришлю, как будет готово…');
    } catch (error) {
      await this.replyWithError(ctx, error);
    }
  }

  /**
   * Доменные ошибки клиента уже несут текст для пользователя (протухший токен,
   * лимит запросов) — берём его; на всё остальное отвечаем общей фразой.
   */
  private async replyWithError(ctx: Context, error: unknown): Promise<void> {
    void this.errors.report({
      error,
      source: 'bot',
      context: 'warehouses',
      telegramUserId: ctx.from?.id?.toString(),
      username: ctx.from?.username,
      chatId: ctx.chat?.id?.toString(),
      botId: ctx.botInfo?.id?.toString(),
      action: 'обзор складов',
    });

    await ctx.reply(warehousesErrorText(error), htmlOptions());
  }
}
