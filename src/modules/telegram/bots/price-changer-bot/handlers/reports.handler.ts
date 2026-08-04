import type { IReportExport } from '../../../../../modules/yandex/reports/order-reports.service';

import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';

import { UserAccessService } from '../../../../../database/services/user-access.service';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { OrderReportsService } from '../../../../../modules/yandex/reports/order-reports.service';
import { formatProfitReport } from '../../../../../modules/yandex/reports/profit-message';
import { ProfitService } from '../../../../../modules/yandex/reports/profit.service';
import { formatReport } from '../../../../../modules/yandex/reports/report-message';
import {
  DEFAULT_PERIOD,
  PERIOD,
  parseDayInput,
  periodButtonLabel,
  type IReportPeriod,
} from '../../../../../modules/yandex/reports/report-period';
import {
  REPORT,
  reportDefinition,
  type TReportKey,
} from '../../../../../modules/yandex/reports/report-status-map';
import { YandexApiError } from '../../../../../modules/yandex/yandex-api.errors';
import { HISTORY_WINDOW_DAYS } from '../../../../../modules/yandex/yandex-api.paths';
import { ErrorReporter } from '../../../../errors/error-reporter.service';
import { TTelegrafBot } from '../../../domain.telegram';
import { esc, htmlOptions } from '../../../formatting/telegram-format';
import { FEATURE, isFeatureEnabled, isReportEnabled } from '../../shared/features.domain';
import { StorePromptService } from '../../shared/services/store-prompt.service';
import { PriceChangerKeyboard } from '../price-changer.keyboard';
import { REPORT_CB_PATTERN, parseReportCallback, reportCallback } from '../report-buttons';

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
    private readonly profit: ProfitService,
    private readonly yandexMarketService: YandexMarketService,
    private readonly keyboard: PriceChangerKeyboard,
    private readonly access: UserAccessService,
    private readonly errors: ErrorReporter,
    private readonly storePrompt: StorePromptService,
  ) {}

  /**
   * Кнопки выбора периода.
   *
   * Регистрируются ОТДЕЛЬНО и раньше общего обработчика callback_query: тот не
   * вызывает next() и его default-ветка съела бы `rep:*`, ответив «Эта кнопка
   * устарела». Ровно так уже пропадал пикер магазина.
   */
  public registerCallbacks(bot: TTelegrafBot): void {
    bot.action(REPORT_CB_PATTERN, async (ctx) => {
      const data = (ctx.callbackQuery as { data?: string }).data ?? '';
      const parsed = parseReportCallback(data);
      await ctx.answerCbQuery();
      if (!parsed) return;

      if (parsed.period === PERIOD.DAY) {
        await this.askDay(ctx, parsed.reportKey);
        return;
      }

      await this.run(ctx, parsed.reportKey, { key: parsed.period });
    });
  }

  /**
   * Спросить конкретный день. Незакрытый вопрос живёт в UserAccess рядом с
   * таким же вопросом про время рассылки — заводить ради него ещё одно
   * хранилище незачем.
   */
  private async askDay(ctx: Context, key: TReportKey): Promise<void> {
    await this.access.setPendingReportDay(ctx.from.id.toString(), ctx.botInfo.id.toString(), key);

    await ctx.reply(
      [
        `🗓 За какой день показать «${esc(reportDefinition(key).title)}»?`,
        '',
        'Пришлите дату — например <code>28-07-2026</code>.',
        '',
        `⚠️ Яндекс.Маркет хранит заказы не старше ${HISTORY_WINDOW_DAYS} дней.`,
      ].join('\n'),
      htmlOptions(),
    );
  }

  /**
   * Обработка присланной даты. Зовётся из обработчика текста, когда у
   * пользователя есть незакрытый вопрос про день отчёта.
   *
   * @returns true, если сообщение было датой и обработано здесь.
   */
  public async handlePendingDay(ctx: Context, text: string): Promise<boolean> {
    const telegramUserId = ctx.from.id.toString();
    const botId = ctx.botInfo.id.toString();

    const account = await this.access.findByUserAndBot(telegramUserId, botId);
    const reportKey = account?.pendingReportDay;
    if (!reportKey) return false;

    const day = parseDayInput(text);
    if (!day) {
      // Вопрос остаётся открытым: пользователь должен ответить ещё раз, не
      // начиная всё заново.
      await ctx.reply(
        'Не понял дату. Нужен формат ДД-ММ-ГГГГ, например <code>28-07-2026</code>.',
        htmlOptions(),
      );
      return true;
    }

    await this.access.setPendingReportDay(telegramUserId, botId, null);
    await this.run(ctx, reportKey as TReportKey, { key: PERIOD.DAY, day });
    return true;
  }

  /**
   * Нажата кнопка отчёта.
   *
   * Сначала спрашиваем период — кроме «Едет до клиента»: это срез «что сейчас
   * в пути» (`dateFilter: 'none'`), период на него не влияет, и кнопка выбора
   * там была бы кнопкой, которая ничего не меняет.
   */
  public async handle(ctx: Context, key: TReportKey): Promise<void> {
    // Нет магазина — сразу отвечаем «нужен магазин» и сбрасываем залипшее меню,
    // не спрашивая период. Иначе для периодных отчётов клавиатура схлопнулась бы
    // только после выбора периода (стена в run()), а тут — на первом нажатии.
    const store = await this.yandexMarketService.findByTelegramUser(ctx.from.id.toString());
    if (!store) {
      await this.storePrompt.replyNeedsStore(ctx);
      return;
    }

    if (key === REPORT.IN_TRANSIT) {
      await this.run(ctx, key, DEFAULT_PERIOD);
      return;
    }
    await this.askPeriod(ctx, key);
  }

  private async askPeriod(ctx: Context, key: TReportKey): Promise<void> {
    const rows = [
      [PERIOD.TODAY, PERIOD.DAY],
      [PERIOD.WEEK, PERIOD.MONTH],
      // «Всего» отдельным рядом и последним: это не ещё один календарный
      // период, а его отсутствие, и в паре с «месяцем» читалось бы как один из
      // равных вариантов.
      [PERIOD.ALL],
    ].map((row) =>
      row.map((period) => ({
        text: periodButtonLabel(period),
        callback_data: reportCallback(period, key),
      })),
    );

    const keyboard = await this.keyboard.createInlineKeyboardMatrix(rows);
    await ctx.reply(
      `${esc(reportDefinition(key).title)} — за какой период?`,
      htmlOptions({ reply_markup: keyboard.reply_markup }),
    );
  }

  public async run(ctx: Context, key: TReportKey, period: IReportPeriod): Promise<void> {
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
      // Перепроверка фичи. Гейт ловит нажатие кнопки, но не ответ ДАТОЙ на
      // «за какой день?»: тот приходит обычным текстом и ни во что не
      // маппится. Здесь единственная воронка обоих путей. Запись доступа
      // читается один раз — ниже из неё же берётся флаг калькулятора.
      const account = await this.access.findByUserAndBot(
        ctx.from.id.toString(),
        ctx.botInfo.id.toString(),
      );
      if (!isReportEnabled(account?.features, key)) {
        await ctx.reply('🔒 Этот отчёт сейчас недоступен.', htmlOptions());
        return;
      }

      const store = await this.yandexMarketService.findByTelegramUser(ctx.from.id.toString());
      if (!store) {
        // Путь ответа датой (handlePendingDay → run) минует handle, поэтому
        // стена нужна и здесь — и тоже сбрасывает залипшее меню.
        await this.storePrompt.replyNeedsStore(ctx);
        return;
      }

      // Пользователь должен видеть, что запрос пошёл: обход страниц занимает
      // секунды, и молчащий бот неотличим от сломанного.
      await ctx.reply('⏳ Собираю отчёт…');

      if (key === REPORT.IN_TRANSIT) {
        await this.sendExport(ctx, await this.reports.exportInTransit(store));
        return;
      }

      // «Едет обратно» уходит файлом: артикулы возвращаемых позиций в тексте
      // не помещаются. Подпись к файлу — тот же текст отчёта.
      if (key === REPORT.RETURNING) {
        await this.sendExport(ctx, await this.reports.exportReturning(store, period));
        return;
      }

      // Прибыль собирается своим сервисом: к заказам добавляется закуп из базы,
      // а вычитания и текст у неё собственные. Строка калькулятора — под
      // флагом tariff_calc; отсутствие записи доступа — администратор (гейт
      // пропускает его до ensure), и флаги для него открыты все, как в
      // allFeaturesEnabled.
      if (key === REPORT.PROFIT) {
        const tariffEstimate = account
          ? isFeatureEnabled(account.features, FEATURE.TARIFF_CALC)
          : true;
        const profit = await this.profit.build(store, period, new Date(), { tariffEstimate });
        await ctx.reply(formatProfitReport(profit), htmlOptions());
        return;
      }

      const result = await this.reports.build(store, key, new Date(), period);
      await ctx.reply(formatReport(result), htmlOptions());
    } catch (error) {
      await this.replyWithError(ctx, key, error);
    } finally {
      // Снимаем защёлку в finally: без этого одна ошибка запирала бы отчёты
      // для пользователя до перезапуска приложения.
      this.inFlight.delete(lock);
    }
  }

  // Отсутствие записи доступа считается «открыто» (см. проверку в run):
  // её нет у администраторов — гейт пропускает их до `ensure()`, — и
  // отказывать им значило бы запереть отчёты ровно у тех, кто раздаёт доступ.

  /** Отправка готовой выгрузки: пустая — текстом, непустая — документом. */
  private async sendExport(ctx: Context, result: IReportExport): Promise<void> {
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
    void this.errors.report({
      error,
      source: 'bot',
      context: `report:${key}`,
      telegramUserId: ctx.from?.id?.toString(),
      username: ctx.from?.username,
      chatId: ctx.chat?.id?.toString(),
      botId: ctx.botInfo?.id?.toString(),
      action: `отчёт ${key}`,
    });

    const message =
      error instanceof YandexApiError
        ? error.userMessage
        : 'Не удалось собрать отчёт. Попробуйте позже.';

    await ctx.reply(`❌ ${message}`, htmlOptions());
  }
}
