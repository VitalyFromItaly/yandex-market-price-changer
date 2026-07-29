import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';

import { ReportScheduleService } from '../../../../../database/services/report-schedule.service';
import { UserAccessService } from '../../../../../database/services/user-access.service';
import {
  REPORT,
  reportDefinition,
  type TReportKey,
} from '../../../../../modules/yandex/reports/report-status-map';
import { DEFAULT_SCHEDULE_TIME } from '../../../../../modules/yandex/reports/schedule-time';
import { TTelegrafBot } from '../../../domain.telegram';
import { esc, htmlOptions } from '../../../formatting/telegram-format';
import { ReportSchedulerService } from '../../../queue/services/report-scheduler.service';
import { MENU } from '../menu.constants';
import { PriceChangerKeyboard } from '../price-changer.keyboard';

/**
 * callback_data раздела рассылки. Формирование и разбор рядом — чтобы формат не
 * разъехался между кнопкой и обработчиком.
 */
export const SCHEDULE_CB_PATTERN = /^sch:(menu|on|off|time):([a-z_]*)$/;

export function scheduleCallback(action: 'menu' | 'on' | 'off' | 'time', reportKey = ''): string {
  return `sch:${action}:${reportKey}`;
}

/** Порядок отчётов в разделе — тот же, что в главном меню. */
const ORDER: TReportKey[] = [
  REPORT.SHIPPED_TODAY,
  REPORT.REDEEMED,
  REPORT.RETURNING,
  REPORT.IN_TRANSIT,
];

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

  /** Показать состояние всех четырёх отчётов. */
  public async showMenu(ctx: Context, edit = false): Promise<void> {
    const telegramUserId = ctx.from.id.toString();
    const botId = ctx.botInfo.id.toString();

    const saved = await this.schedules.listForUser(telegramUserId, botId);
    const byKey = new Map(saved.map((doc) => [doc.reportKey, doc]));

    const lines = [
      `⏰ <b>Ежедневная рассылка</b>`,
      '',
      '🕒 Время указывается <b>по Москве</b>.',
      '',
    ];

    const rows: { text: string; callback_data: string }[][] = [];

    for (const key of ORDER) {
      const doc = byKey.get(key);
      const enabled = !!doc?.enabled;
      const time = doc?.time ?? DEFAULT_SCHEDULE_TIME;
      const title = reportDefinition(key).title;

      lines.push(`${enabled ? '✅' : '⬜'} <b>${esc(title)}</b> — ${esc(time)}`);

      rows.push([
        {
          text: `${enabled ? '🔕 Выключить' : '🔔 Включить'}: ${title}`,
          callback_data: scheduleCallback(enabled ? 'off' : 'on', key),
        },
        { text: `🕒 ${time}`, callback_data: scheduleCallback('time', key) },
      ]);
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
