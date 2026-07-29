import type { YandexMarketDocument } from '../../../../../database/schemas/yandex-market.schema';

import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';

import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { OrderReportsService } from '../../../../../modules/yandex/reports/order-reports.service';
import { formatReport } from '../../../../../modules/yandex/reports/report-message';
import { REPORT, type TReportKey } from '../../../../../modules/yandex/reports/report-status-map';
import { YandexApiError } from '../../../../../modules/yandex/yandex-api.errors';
import { htmlOptions } from '../../../formatting/telegram-format';
import { MENU } from '../menu.constants';

/** Кнопка меню → отчёт. Единственное место, где они связаны. */
export const MENU_TO_REPORT: Readonly<Record<string, TReportKey>> = {
  [MENU.SHIPPED_TODAY]: REPORT.SHIPPED_TODAY,
  [MENU.REDEEMED]: REPORT.REDEEMED,
  [MENU.RETURNING]: REPORT.RETURNING,
  [MENU.IN_TRANSIT]: REPORT.IN_TRANSIT,
};

/**
 * Показ отчётов пользователю.
 *
 * Обход страниц Partner API занимает заметное время — секунды, а у крупного
 * продавца и десятки. Без индикации бот выглядит зависшим, и пользователь жмёт
 * кнопку ещё раз; каждое нажатие — это новый полный обход, который жжёт часовую
 * квоту метода. Поэтому здесь и подсказка «собираю», и защёлка от повторного
 * запуска.
 */
@Injectable()
export class ReportsHandler {
  private readonly logger = new Logger(ReportsHandler.name);

  /**
   * Кто прямо сейчас строит отчёт. В памяти процесса: защёлка нужна на секунды
   * и только против двойного нажатия одним человеком. Тащить ради этого Redis
   * незачем — при рестарте худшее, что случится, это один лишний обход.
   */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly reports: OrderReportsService,
    private readonly yandexMarketService: YandexMarketService,
  ) {}

  public async handle(ctx: Context, key: TReportKey): Promise<void> {
    const lock = `${ctx.botInfo.id}:${ctx.from.id}`;

    if (this.inFlight.has(lock)) {
      await ctx.reply('⏳ Отчёт уже собирается, подождите немного.');
      return;
    }

    // Защёлка ставится ДО первого await, синхронно с проверкой. Если поставить
    // её после любого ожидания — хоть чтения настроек из Mongo, — два быстрых
    // нажатия успеют проскочить проверку оба, и уйдут два полных обхода
    // страниц Partner API вместо одного.
    this.inFlight.add(lock);

    try {
      const store = await this.yandexMarketService.findByTelegramUser(ctx.from.id.toString());
      if (!store) {
        await ctx.reply('⚠️ Сначала заполните настройки API.', htmlOptions());
        return;
      }

      // Пользователь должен видеть, что запрос пошёл: обход страниц занимает
      // секунды, и молчащий бот неотличим от сломанного.
      await ctx.reply('⏳ Собираю отчёт…');

      if (key === REPORT.IN_TRANSIT) {
        await this.sendExport(ctx, store);
        return;
      }

      const result = await this.reports.build(store, key);
      await ctx.reply(formatReport(result), htmlOptions());
    } catch (error) {
      await this.replyWithError(ctx, key, error);
    } finally {
      // Снимаем защёлку в finally: без этого одна ошибка запирала бы отчёты
      // для пользователя до перезапуска приложения.
      this.inFlight.delete(lock);
    }
  }

  private async sendExport(ctx: Context, store: YandexMarketDocument): Promise<void> {
    const result = await this.reports.exportInTransit(store);

    if (result.empty) {
      await ctx.reply(result.message, htmlOptions());
      return;
    }

    await ctx.replyWithDocument(
      { source: result.buffer, filename: result.filename },
      htmlOptions({ caption: result.caption }),
    );
  }

  /**
   * Ошибка должна быть понятной. Доменные ошибки клиента уже несут текст для
   * пользователя (протухший токен, лимит запросов) — берём его; на всё
   * остальное отвечаем общей фразой, не показывая внутренности.
   */
  private async replyWithError(ctx: Context, key: TReportKey, error: unknown): Promise<void> {
    this.logger.error(`Не удалось собрать отчёт ${key} для ${ctx.from.id}`, error as Error);

    const message =
      error instanceof YandexApiError
        ? error.userMessage
        : 'Не удалось собрать отчёт. Попробуйте позже.';

    await ctx.reply(`❌ ${message}`, htmlOptions());
  }
}
