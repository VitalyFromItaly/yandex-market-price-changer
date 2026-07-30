import type { UserAccessDocument } from '../../../../../database/schemas/user-access.schema';
import type { TTelegrafBot } from '../../../domain.telegram';

import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';

import { AppConfigService } from '../../../../../config/app-config.service';
import { UserAccessService } from '../../../../../database/services/user-access.service';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { b, code, esc, htmlOptions, splitMessage } from '../../../formatting/telegram-format';

/**
 * Раздел администратора: кто пользуется ботом и как закрыть доступ.
 *
 * Раньше администратор видел пользователя ровно один раз — в карточке заявки.
 * После решения список был недоступен нигде, а отозвать выданный доступ нельзя
 * было вообще: единственный путь лежал через ручную правку документа в Mongo.
 *
 * Писать пользователю бот не помогает намеренно (решение заказчика): ник
 * отдаётся ссылкой t.me, администратор тапает и пишет напрямую. Пересылка
 * через бота потребовала бы хранить переписку и решать, кому адресован ответ.
 */

/** Префикс callback_data. Идентификатор пользователя идёт следом. */
export const REVOKE_PREFIX = 'admin_revoke:';
export const REVOKE_CONFIRM_PREFIX = 'admin_revoke_yes:';

/** Сколько пользователей показывать. Дальше — счётчиком. */
const LIST_LIMIT = 50;

const STATUS_LABEL: Record<string, string> = {
  approved: '✅ доступ есть',
  pending: '⏳ ждёт решения',
  rejected: '⛔ доступа нет',
  new: '🆕 регистрируется',
};

@Injectable()
export class AdminUsersHandler {
  private readonly logger = new Logger(AdminUsersHandler.name);

  constructor(
    private readonly accessService: UserAccessService,
    private readonly yandexMarketService: YandexMarketService,
    private readonly config: AppConfigService,
  ) {}

  public register(bot: TTelegrafBot): void {
    bot.command('users', async (ctx) => {
      // Молчим, а не отвечаем «нет прав»: посторонний не должен даже узнать,
      // что такая команда существует.
      if (!this.config.isAdmin(ctx.from.id)) return;
      await this.sendList(ctx);
    });

    bot.action(new RegExp(`^${REVOKE_PREFIX}`), async (ctx) => {
      if (!this.config.isAdmin(ctx.from.id)) {
        await ctx.answerCbQuery('Недостаточно прав');
        return;
      }
      await this.askConfirmation(ctx);
    });

    bot.action(new RegExp(`^${REVOKE_CONFIRM_PREFIX}`), async (ctx) => {
      if (!this.config.isAdmin(ctx.from.id)) {
        await ctx.answerCbQuery('Недостаточно прав');
        return;
      }
      await this.revoke(ctx);
    });
  }

  /** Доступен ли раздел этому пользователю — для показа кнопки в меню. */
  public isAdmin(telegramUserId: number): boolean {
    return this.config.isAdmin(telegramUserId);
  }

  public async sendList(ctx: Context): Promise<void> {
    const botId = ctx.botInfo.id.toString();

    const [counts, users] = await Promise.all([
      this.accessService.countByStatus(botId),
      this.accessService.listByBot(botId),
    ]);

    const total = Object.values(counts).reduce((s, n) => s + n, 0);

    const lines: string[] = [
      `👥 ${b('Пользователи бота')}`,
      '',
      `Всего: ${b(total)}`,
      `${STATUS_LABEL.approved}: ${b(counts.approved ?? 0)}`,
      `${STATUS_LABEL.pending}: ${b(counts.pending ?? 0)}`,
      `${STATUS_LABEL.rejected}: ${b(counts.rejected ?? 0)}`,
    ];

    if (counts.new) {
      lines.push(`${STATUS_LABEL.new}: ${b(counts.new)}`);
    }

    if (!total) {
      lines.push('', 'Пока никто не регистрировался.');
      await ctx.reply(lines.join('\n'), htmlOptions());
      return;
    }

    lines.push('');

    for (const user of users.slice(0, LIST_LIMIT)) {
      lines.push(await this.formatUser(user));
    }

    if (users.length > LIST_LIMIT) {
      lines.push('', `…и ещё ${users.length - LIST_LIMIT}`);
    }

    // Список легко перерастает лимит Telegram в 4096 символов, а превышение —
    // это 400 и сообщение, которое не дойдёт вовсе.
    const chunks = splitMessage(lines.join('\n'));
    for (const chunk of chunks) {
      await ctx.reply(chunk, htmlOptions());
    }

    // Кнопки отзыва — отдельным сообщением: по одной на каждого, у кого
    // доступ есть. Внутри текста их не разместить, а гадать по никам админу
    // не с руки.
    const approved = users.filter((u) => u.status === 'approved');
    if (approved.length) {
      await ctx.reply(
        'Закрыть доступ:',
        htmlOptions({
          reply_markup: {
            inline_keyboard: approved.slice(0, LIST_LIMIT).map((u) => [
              {
                text: `⛔ ${this.plainName(u)}`,
                callback_data: `${REVOKE_PREFIX}${u.telegramUserId}`,
              },
            ]),
          },
        }),
      );
    }
  }

  /**
   * Отзыв спрашивает подтверждение. Одно случайное касание не должно
   * отключать работающего продавца — восстановить можно только новой заявкой,
   * а до тех пор сутки действует запрет на повторную регистрацию.
   */
  private async askConfirmation(ctx: Context): Promise<void> {
    const userId = this.userIdFrom(ctx, REVOKE_PREFIX);
    if (!userId) return;

    const user = await this.accessService.findByUserAndBot(userId, ctx.botInfo.id.toString());
    await ctx.answerCbQuery();

    await ctx.reply(
      [
        `⚠️ Закрыть доступ: ${user ? this.displayName(user) : code(userId)}?`,
        '',
        'Пользователь перестанет получать отчёты сразу.',
        'Повторно зарегистрироваться он сможет через сутки.',
      ].join('\n'),
      htmlOptions({
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '⛔ Да, закрыть',
                callback_data: `${REVOKE_CONFIRM_PREFIX}${userId}`,
              },
            ],
          ],
        },
      }),
    );
  }

  private async revoke(ctx: Context): Promise<void> {
    const userId = this.userIdFrom(ctx, REVOKE_CONFIRM_PREFIX);
    if (!userId) return;

    const botId = ctx.botInfo.id.toString();

    const revoked = await this.accessService.revoke(userId, botId, {
      id: ctx.from.id.toString(),
      username: ctx.from.username,
    });

    if (!revoked) {
      // Фильтр по status:'approved' не совпал: другой администратор успел
      // раньше либо доступа уже не было.
      await ctx.answerCbQuery('Доступ уже закрыт');
      await ctx.editMessageText('Доступ уже был закрыт ранее.');
      return;
    }

    await ctx.answerCbQuery('Доступ закрыт');
    await ctx.editMessageText(`⛔ Доступ закрыт: ${this.displayName(revoked)}`, htmlOptions());

    this.logger.log(`Администратор ${ctx.from.id} закрыл доступ пользователю ${userId}`);

    // Уведомляем пользователя. Молчаливое отключение выглядит как поломка
    // бота, и он придёт разбираться именно как с поломкой.
    try {
      await ctx.telegram.sendMessage(
        revoked.telegramChatId,
        '⛔ Доступ к боту закрыт администратором.',
      );
    } catch (error) {
      // Пользователь мог заблокировать бота — это не повод считать отзыв
      // неудавшимся, статус уже изменён.
      this.logger.warn(`Не удалось уведомить ${userId} о закрытии доступа: ${String(error)}`);
    }
  }

  private userIdFrom(ctx: Context, prefix: string): string | null {
    const data = (ctx.callbackQuery as { data?: string } | undefined)?.data ?? '';
    const id = data.slice(prefix.length).trim();
    return id || null;
  }

  /** Ник ссылкой — чтобы администратор тапнул и написал напрямую. */
  /**
   * Подпись для КНОПКИ — обычный текст, без разметки.
   *
   * Telegram применяет parse_mode только к тексту сообщения; подпись кнопки он
   * показывает буквально. Из-за displayName() на кнопке «Закрыть доступ»
   * красовалось `<a href="https://t.me/artonik1">@artonik1</a> (Тема)` целиком,
   * вместе с тегами. htmlOptions() рядом этому не помогает и помочь не может —
   * он задаёт parse_mode сообщения, а не клавиатуры.
   */
  private plainName(user: UserAccessDocument): string {
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ');

    if (user.username) return `@${user.username}${name ? ` (${name})` : ''}`;
    return name ? `${name} ${user.telegramUserId}` : user.telegramUserId;
  }

  /** Подпись для ТЕКСТА СООБЩЕНИЯ — со ссылкой на диалог, HTML. */
  private displayName(user: UserAccessDocument): string {
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ');

    if (user.username) {
      return `<a href="https://t.me/${esc(user.username)}">@${esc(user.username)}</a>${
        name ? ` (${esc(name)})` : ''
      }`;
    }

    // Без ника ссылку не построить: t.me/<id> не открывает диалог.
    return name ? `${esc(name)} ${code(user.telegramUserId)}` : code(user.telegramUserId);
  }

  private async formatUser(user: UserAccessDocument): Promise<string> {
    const status = STATUS_LABEL[user.status] ?? esc(user.status);
    const configured = await this.yandexMarketService.isConfigured(user.telegramUserId);

    const when = user.approvedAt ?? user.rejectedAt ?? user.appliedAt;
    const date = when ? new Date(when).toLocaleDateString('ru-RU') : '—';

    return `• ${this.displayName(user)} — ${status}, ${date}${configured ? '' : ', без настроек'}`;
  }
}
