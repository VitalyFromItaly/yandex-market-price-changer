import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';
import { TTelegrafBot } from '../../../domain.telegram';
import { htmlOptions } from '../../../formatting/telegram-format';
import { AppConfigService } from '../../../../../config/app-config.service';
import { UserAccessService } from '../../../../../database/services/user-access.service';
import type { UserAccessDocument } from '../../../../../database/schemas/user-access.schema';
import {
  canPass,
  classifyUpdate,
  hoursUntilRetry,
  isRejectionExpired,
  REJECTION_COOLDOWN_MS,
} from '../../shared/access.domain';

/**
 * Гейт доступа: единственная точка, где решается, пускать апдейт дальше.
 *
 * Почему один bot.use, а не проверка в каждом хендлере. Прежний гейт (подписка)
 * стоял ровно в одном месте — в обработчике /start. Всё остальное его просто не
 * вызывало: загрузка файла, процессоры очередей, любая кнопка меню. Пользователь,
 * не нажимавший /start, не проверялся никогда. Проверка, зарегистрированная
 * ПЕРВОЙ в пайплайне, не может быть забыта в новом хендлере — потому что
 * новый хендлер регистрируется после неё.
 *
 * Таблица допуска живёт в access.domain.ts и покрыта юнит-тестами: там она
 * проверяется без telegraf и без базы.
 */
@Injectable()
export class AccessGateHandler {
  private readonly logger = new Logger(AccessGateHandler.name);

  constructor(
    private readonly accessService: UserAccessService,
    private readonly config: AppConfigService,
  ) {}

  public register(bot: TTelegrafBot) {
    bot.use(async (ctx, next) => {
      // Апдейты без отправителя (посты в канале и т.п.) гейт не касается.
      if (!ctx.from) return next();

      // Администраторы проходят всегда и записи доступа не получают: иначе
      // администратор-продавец прислал бы заявку сам себе.
      if (this.config.isAdmin(ctx.from.id)) return next();

      // Бот рассчитан на личку. В группе ctx.chat.id ≠ ctx.from.id, и запись
      // доступа завелась бы на группу. Выходим молча, не засоряя чат.
      if (ctx.chat && ctx.chat.type !== 'private') return;

      const kind = classifyUpdate({
        text: this.textOf(ctx),
        callbackData: this.callbackDataOf(ctx),
      });

      // /start обязан работать при любом статусе: это единственный способ для
      // пользователя узнать, что с его заявкой.
      if (kind === 'start') {
        await this.touch(ctx);
        return next();
      }

      const access = await this.resolve(ctx);
      if (canPass(access.status, kind)) return next();

      await this.block(ctx, access);
    });
  }

  /** Завести или освежить запись доступа + лениво снять протухший отказ. */
  private async resolve(ctx: Context): Promise<UserAccessDocument> {
    const access = await this.touch(ctx);
    if (access.status !== 'rejected') return access;

    const now = new Date();
    if (!isRejectionExpired(access.rejectedAt, now)) return access;

    // Срок ещё раз проверяется в фильтре запроса, поэтому два параллельных
    // апдейта не сбросят статус дважды. Крон для этого не нужен: ждать
    // истечения запрета, кроме самого пользователя, некому.
    const cutoff = new Date(now.getTime() - REJECTION_COOLDOWN_MS);
    const revived = await this.accessService.expireRejection(
      access.telegramUserId,
      access.botId,
      cutoff,
    );
    return revived ?? access;
  }

  private async touch(ctx: Context): Promise<UserAccessDocument> {
    return await this.accessService.ensure({
      telegramUserId: ctx.from.id.toString(),
      botId: ctx.botInfo.id.toString(),
      telegramChatId: (ctx.chat?.id ?? ctx.from.id).toString(),
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
    });
  }

  private async block(ctx: Context, access: UserAccessDocument): Promise<void> {
    const text = this.blockText(access);

    // На callback_query обязательно нужно ответить, иначе кнопка у клиента
    // крутится ~30 секунд. И ни в коем случае не звать next(): default-ветка
    // общего обработчика перезапишет сообщение «Неизвестной командой».
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery(this.shortBlockText(access), { show_alert: true });
      return;
    }

    await ctx.reply(text, htmlOptions());
  }

  private blockText(access: UserAccessDocument): string {
    switch (access.status) {
      case 'pending':
        return [
          '⏳ Заявка на рассмотрении.',
          '',
          'Доступ откроется, как только администратор её одобрит — бот пришлёт',
          'сообщение сюда же.',
        ].join('\n');

      case 'rejected':
        return [
          '⛔ Заявка отклонена.',
          '',
          `Повторная регистрация будет доступна через ${hoursUntilRetry(access.rejectedAt, new Date())} ч.`,
        ].join('\n');

      default:
        return [
          '🔐 Сначала нужно подать заявку на доступ.',
          '',
          'Пришлите три значения из личного кабинета Яндекс.Маркета — по одному',
          'сообщению:',
          '',
          '<code>Campaign ID: ваш_id</code>',
          '<code>Business ID: ваш_id</code>',
          '<code>Token: ваш_токен</code>',
        ].join('\n');
    }
  }

  /** Всплывающее окно Telegram ограничено 200 символами. */
  private shortBlockText(access: UserAccessDocument): string {
    switch (access.status) {
      case 'pending':
        return 'Заявка на рассмотрении';
      case 'rejected':
        return `Заявка отклонена. Повторно через ${hoursUntilRetry(access.rejectedAt, new Date())} ч.`;
      default:
        return 'Сначала заполните настройки API';
    }
  }

  private textOf(ctx: Context): string | undefined {
    const message = ctx.message as { text?: string } | undefined;
    return message?.text;
  }

  private callbackDataOf(ctx: Context): string | undefined {
    const query = ctx.callbackQuery as { data?: string } | undefined;
    return query?.data;
  }
}
