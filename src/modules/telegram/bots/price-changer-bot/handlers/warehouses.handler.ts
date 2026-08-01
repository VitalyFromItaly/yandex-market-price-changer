import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';

import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { formatWarehousesOverview } from '../../../../../modules/yandex/warehouses/warehouses-message';
import { WarehousesService } from '../../../../../modules/yandex/warehouses/warehouses.service';
import { YandexApiError } from '../../../../../modules/yandex/yandex-api.errors';
import { ErrorReporter } from '../../../../errors/error-reporter.service';
import { htmlOptions } from '../../../formatting/telegram-format';

/**
 * Обзор складов продавца по типам (FBY и склад магазина).
 *
 * Зовётся из кнопки меню «🏬 Склады» через MenuCommandsHandler — как отчёты
 * через ReportsHandler, поэтому в пайплайн composer'а отдельным шагом не
 * встаёт. Доступ закрыт фичей `warehouses` (по умолчанию выключена): гейт
 * возможностей отбивает кнопку раньше этого хендлера, свободного текста у
 * обзора нет, так что перепроверять флаг здесь не нужно.
 *
 * Запрос к Partner API — только чтение (два GET), никакой записи.
 */
@Injectable()
export class WarehousesHandler {
  /**
   * Кто прямо сейчас строит обзор. В памяти процесса — защёлка против двойного
   * нажатия одним человеком, как в ReportsHandler: два быстрых нажатия иначе
   * ушли бы двумя парами запросов вместо одной.
   */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly warehouses: WarehousesService,
    private readonly stores: YandexMarketService,
    private readonly errors: ErrorReporter,
  ) {}

  public async handle(ctx: Context): Promise<void> {
    const lock = `${ctx.botInfo.id}:${ctx.from.id}`;
    if (this.inFlight.has(lock)) {
      await ctx.reply('⏳ Список складов уже собирается, подождите немного.');
      return;
    }
    this.inFlight.add(lock);

    try {
      const store = await this.stores.findByTelegramUser(ctx.from.id.toString());
      if (!store) {
        await ctx.reply('⚠️ Сначала заполните настройки API.', htmlOptions());
        return;
      }

      await ctx.reply('⏳ Собираю список складов…');

      const overview = await this.warehouses.overview(store);
      await ctx.reply(formatWarehousesOverview(overview), htmlOptions());
    } catch (error) {
      await this.replyWithError(ctx, error);
    } finally {
      this.inFlight.delete(lock);
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

    const message =
      error instanceof YandexApiError
        ? error.userMessage
        : 'Не удалось получить список складов. Попробуйте позже.';

    await ctx.reply(`❌ ${message}`, htmlOptions());
  }
}
