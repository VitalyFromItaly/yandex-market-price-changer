import type { TFeatureKey } from '../../shared/features.domain';

import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';

import { AppConfigService } from '../../../../../config/app-config.service';
import { UserAccessService } from '../../../../../database/services/user-access.service';
import { TTelegrafBot } from '../../../domain.telegram';
import { esc, htmlOptions } from '../../../formatting/telegram-format';
import { FEATURE_META, isFeatureEnabled, requiredFeatures } from '../../shared/features.domain';

/**
 * Гейт возможностей: пускать ли ЭТОТ апдейт к ЭТОЙ функции бота.
 *
 * Отдельным шагом, а не проверкой внутри каждого хендлера, по той же причине,
 * по которой отдельным шагом стоит `accessGate`: проверку, зарегистрированную
 * в пайплайне, нельзя забыть в новом хендлере — новый хендлер регистрируется
 * после неё. Прошлый гейт (он стоял в одном /start) не проверял ни загрузку
 * файла, ни кнопки меню, и это ровно тот дефект, который здесь не хочется
 * повторить.
 *
 * Стоит ПОСЛЕ `accessGate`: «вас ещё не одобрили» — более раннее и более
 * важное объяснение, чем «эта функция вам закрыта». Человеку без доступа
 * рассказывать про отдельные функции бессмысленно.
 *
 * Не покрывает свободный текст: ответ датой на «за какой день?» и временем на
 * «во сколько присылать?» приходит обычной строкой и ни во что не маппится.
 * Эти два места перепроверяют флаг у себя — `ReportsHandler.run` и
 * `ScheduleHandler.handlePendingTime`.
 */
@Injectable()
export class FeatureGateHandler {
  private readonly logger = new Logger(FeatureGateHandler.name);

  constructor(
    private readonly accessService: UserAccessService,
    private readonly config: AppConfigService,
  ) {}

  public register(bot: TTelegrafBot) {
    bot.use(async (ctx, next) => {
      if (!ctx.from) return next();

      // Администраторы проходят всегда — записи доступа у них нет вовсе
      // (гейт доступа возвращает раньше `ensure`), и флагов для них не
      // существует.
      if (this.config.isAdmin(ctx.from.id)) return next();

      const needed = requiredFeatures({
        text: this.textOf(ctx),
        callbackData: this.callbackDataOf(ctx),
        hasDocument: this.hasDocument(ctx),
      });

      // Ранний выход ДО обращения к базе. Большинство апдейтов — свободный
      // текст, онбординг, настройки, справка — ни во что не маппится, и
      // лишнего чтения на них быть не должно.
      if (needed.length === 0) return next();

      const access = await this.accessService.findByUserAndBot(
        ctx.from.id.toString(),
        ctx.botInfo.id.toString(),
      );

      const blocked = needed.find((key) => !isFeatureEnabled(access?.features, key));
      if (!blocked) return next();

      await this.block(ctx, blocked);
    });
  }

  private async block(ctx: Context, feature: TFeatureKey): Promise<void> {
    const label = FEATURE_META[feature].label;

    // На callback_query нужно ответить обязательно, иначе кнопка у клиента
    // крутится ~30 секунд. И ни в коем случае не звать next(): default-ветка
    // общего обработчика перезапишет сообщение «Неизвестной командой».
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery(`«${label}» сейчас недоступно`, { show_alert: true });
      return;
    }

    await ctx.reply(
      [
        `🔒 Возможность «${esc(label)}» сейчас недоступна.`,
        '',
        'Её открывает администратор бота. Напишите ему, если она вам нужна.',
      ].join('\n'),
      htmlOptions(),
    );
  }

  private textOf(ctx: Context): string | undefined {
    const message = ctx.message as { text?: string } | undefined;
    return message?.text;
  }

  private callbackDataOf(ctx: Context): string | undefined {
    const query = ctx.callbackQuery as { data?: string } | undefined;
    return query?.data;
  }

  private hasDocument(ctx: Context): boolean {
    const message = ctx.message as { document?: unknown } | undefined;
    return !!message?.document;
  }
}
