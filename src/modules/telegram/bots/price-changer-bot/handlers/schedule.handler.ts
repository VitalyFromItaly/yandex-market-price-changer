import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';

import { ReportScheduleService } from '../../../../../database/services/report-schedule.service';
import { UserAccessService } from '../../../../../database/services/user-access.service';
import {
  nextSchedulePeriod,
  periodShortLabel,
  schedulePeriod,
} from '../../../../../modules/yandex/reports/report-period';
import {
  REPORT,
  reportDefinition,
  type TReportKey,
} from '../../../../../modules/yandex/reports/report-status-map';
import { DEFAULT_SCHEDULE_TIME } from '../../../../../modules/yandex/reports/schedule-time';
import { TTelegrafBot } from '../../../domain.telegram';
import { esc, htmlOptions } from '../../../formatting/telegram-format';
import { ReportSchedulerService } from '../../../queue/services/report-scheduler.service';
import {
  FEATURE,
  enabledReports,
  isFeatureEnabled,
  isReportEnabled,
} from '../../shared/features.domain';
import { MENU } from '../menu.constants';
import { PriceChangerKeyboard } from '../price-changer.keyboard';
import { SCHEDULE_CB_PATTERN, scheduleCallback } from '../report-buttons';

/**
 * Настройка ежедневной рассылки.
 *
 * Время ВСЕГДА московское, и об этом написано прямо в интерфейсе: продавец,
 * сидящий во Владивостоке, иначе задаст 9 утра и будет недоумевать, почему
 * отчёт приходит в три часа дня.
 */
@Injectable()
export class ScheduleHandler {
  private readonly logger = new Logger(ScheduleHandler.name);

  constructor(
    private readonly keyboard: PriceChangerKeyboard,
    private readonly schedules: ReportScheduleService,
    private readonly scheduler: ReportSchedulerService,
    private readonly access: UserAccessService,
  ) {}

  public register(bot: TTelegrafBot) {
    bot.action(SCHEDULE_CB_PATTERN, async (ctx) => {
      const data = (ctx.callbackQuery as { data?: string }).data ?? '';
      const [, action, reportKey] = SCHEDULE_CB_PATTERN.exec(data) ?? [];

      try {
        switch (action) {
          case 'on':
          case 'off':
            await this.toggle(ctx, reportKey as TReportKey, action === 'on');
            break;
          case 'time':
            await this.askTime(ctx, reportKey as TReportKey);
            break;
          case 'period':
            await this.cyclePeriod(ctx, reportKey as TReportKey);
            break;
          default:
            await ctx.answerCbQuery();
            await this.showMenu(ctx, true);
        }
      } catch (error) {
        this.logger.error('Ошибка в настройках рассылки', error as Error);
        await ctx.answerCbQuery('Не удалось изменить настройку', { show_alert: true });
      }
    });
  }

  /** Показать состояние доступных пользователю отчётов. */
  public async showMenu(ctx: Context, edit = false): Promise<void> {
    const telegramUserId = ctx.from.id.toString();
    const botId = ctx.botInfo.id.toString();

    const [saved, account] = await Promise.all([
      this.schedules.listForUser(telegramUserId, botId),
      this.access.findByUserAndBot(telegramUserId, botId),
    ]);
    const byKey = new Map(saved.map((doc) => [doc.reportKey, doc]));
    // Порядок — тот же, что в главном меню; отчёты, закрытые администратором,
    // сюда не попадают: расписание для недоступного отчёта — расписание,
    // которое никогда не сработает.
    const order = enabledReports(account?.features);

    /**
     * Состояние живёт НА КНОПКАХ, а не списком в сообщении.
     *
     * Раньше подпись была «🔕 Выключить: Уехало клиенту» — 28 символов в ряду
     * из двух кнопок. Telegram обрезает такую до «🔕 Вклю...клиенту», где
     * неразличимы ни действие («Включить» и «Выключить» дают одинаковый
     * огрызок «Вклю…»), ни отчёт. Галочка вместо глагола короче названия
     * отчёта и не обрезается, а состояние читается прямо с кнопки — поэтому
     * дублирующий список из сообщения убран.
     */
    const lines = [
      `⏰ <b>Ежедневная рассылка</b>`,
      '',
      'Нажмите на отчёт, чтобы включить или выключить его.',
      'Кнопка со временем меняет час отправки.',
      '',
      '🕒 Время указывается <b>по Москве</b>.',
    ];

    const rows: { text: string; callback_data: string }[][] = [];

    for (const key of order) {
      const doc = byKey.get(key);
      const enabled = !!doc?.enabled;
      const time = doc?.time ?? DEFAULT_SCHEDULE_TIME;
      const title = reportDefinition(key).title;

      rows.push([
        {
          text: `${enabled ? '✅' : '⬜'} ${title}`,
          callback_data: scheduleCallback(enabled ? 'off' : 'on', key),
        },
        { text: `🕒 ${time}`, callback_data: scheduleCallback('time', key) },
      ]);

      // Период — ОТДЕЛЬНЫМ рядом, во всю ширину. Третьей кнопкой в ряду он
      // ужал бы соседей до неразличимых огрызков — ровно та беда, из-за
      // которой подписи выше стали галочкой вместо глагола.
      //
      // «Едет до клиента» — срез «что сейчас в пути», период на него не
      // влияет; кнопка, которая ничего не меняет, хуже её отсутствия.
      if (key !== REPORT.IN_TRANSIT) {
        const period = schedulePeriod(doc?.period);
        rows.push([
          {
            text: `📅 Период: ${periodShortLabel(period)}`,
            callback_data: scheduleCallback('period', key),
          },
        ]);
      }
    }

    rows.push([{ text: MENU.MAIN, callback_data: 'main_menu' }]);

    const keyboard = await this.keyboard.createInlineKeyboardMatrix(rows);
    const text = lines.join('\n');

    if (edit) {
      // «message is not modified» прилетает, когда состояние не изменилось, —
      // это не ошибка, а нормальный исход повторного нажатия.
      try {
        await ctx.editMessageText(text, htmlOptions({ reply_markup: keyboard.reply_markup }));
        return;
      } catch {
        return;
      }
    }

    await ctx.reply(text, htmlOptions({ reply_markup: keyboard.reply_markup }));
  }

  private async toggle(ctx: Context, reportKey: TReportKey, enabled: boolean): Promise<void> {
    const key = {
      telegramUserId: ctx.from.id.toString(),
      botId: ctx.botInfo.id.toString(),
      reportKey,
    };

    const doc = await this.schedules.setEnabled(key, enabled);

    // Расписание в Redis меняется вместе с настройкой, а не «когда-нибудь при
    // следующем старте»: иначе включённая рассылка не работала бы до деплоя.
    if (enabled) {
      await this.scheduler.schedule(key, doc.time);
    } else {
      await this.scheduler.unschedule(key);
    }

    await ctx.answerCbQuery(enabled ? `Включено на ${doc.time} МСК` : 'Выключено');
    await this.showMenu(ctx, true);
  }

  /**
   * Перебор периода по кругу.
   *
   * Одним нажатием, без отдельного экрана выбора: вариантов всего три, и
   * текущий написан прямо на кнопке — открывать ради них подменю значило бы
   * добавить шаг туда, где хватает одного тапа.
   */
  private async cyclePeriod(ctx: Context, reportKey: TReportKey): Promise<void> {
    const key = {
      telegramUserId: ctx.from.id.toString(),
      botId: ctx.botInfo.id.toString(),
      reportKey,
    };

    const current = schedulePeriod((await this.schedules.findOne(key))?.period);
    const next = nextSchedulePeriod(current);

    await this.schedules.setPeriod(key, next);
    await ctx.answerCbQuery(periodShortLabel(next));
    await this.showMenu(ctx, true);
  }

  private async askTime(ctx: Context, reportKey: TReportKey): Promise<void> {
    await this.access.setPendingSchedule(
      ctx.from.id.toString(),
      ctx.botInfo.id.toString(),
      reportKey,
    );

    await ctx.answerCbQuery();
    await ctx.reply(
      [
        `🕒 Во сколько присылать «${esc(reportDefinition(reportKey).title)}»?`,
        '',
        'Пришлите время <b>по Москве</b> — например <code>09:00</code> или <code>21:30</code>.',
      ].join('\n'),
      htmlOptions(),
    );
  }

  /**
   * Обработка присланного времени. Вызывается из обработчика текста, когда у
   * пользователя есть незакрытый вопрос про время.
   *
   * @returns true, если сообщение было временем и обработано здесь.
   */
  public async handlePendingTime(ctx: Context, text: string): Promise<boolean> {
    const telegramUserId = ctx.from.id.toString();
    const botId = ctx.botInfo.id.toString();

    const account = await this.access.findByUserAndBot(telegramUserId, botId);
    const reportKey = account?.pendingScheduleReport;
    if (!reportKey) return false;

    // Пока вопрос про время оставался открытым, доступ могли закрыть. Ответ на
    // него приходит обычным текстом — то есть мимо гейта фич, который видит
    // только кнопки и документы.
    if (
      !isFeatureEnabled(account.features, FEATURE.SCHEDULE) ||
      !isReportEnabled(account.features, reportKey)
    ) {
      await this.access.setPendingSchedule(telegramUserId, botId, null);
      await ctx.reply('🔒 Рассылка этого отчёта сейчас недоступна.', htmlOptions());
      return true;
    }

    const key = { telegramUserId, botId, reportKey };
    const result = await this.schedules.setTime(key, text);

    if (!result.ok) {
      // Вопрос остаётся открытым: пользователь должен иметь возможность
      // ответить ещё раз, не начиная всё заново.
      await ctx.reply(`❌ ${esc(result.error)}\n\nПопробуйте ещё раз.`, htmlOptions());
      return true;
    }

    await this.access.setPendingSchedule(telegramUserId, botId, null);

    // Время изменилось — задачу нужно перенести, но только если рассылка
    // включена: иначе мы завели бы расписание, которого пользователь не просил.
    if (result.schedule.enabled) {
      await this.scheduler.schedule(key, result.schedule.time);
    }

    await ctx.reply(
      `✅ Время сохранено: <b>${esc(result.schedule.time)}</b> по Москве.`,
      htmlOptions(),
    );
    await this.showMenu(ctx);
    return true;
  }
}
