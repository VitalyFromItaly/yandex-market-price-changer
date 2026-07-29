import type {
  IAdminCard,
  UserAccessDocument,
} from '../../../../../database/schemas/user-access.schema';
import type { YandexMarketDocument } from '../../../../../database/schemas/yandex-market.schema';

import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';

import { AppConfigService } from '../../../../../config/app-config.service';
import { UserAccessService } from '../../../../../database/services/user-access.service';
import { esc, htmlOptions } from '../../../formatting/telegram-format';
import { PriceChangerKeyboard } from '../../price-changer-bot/price-changer.keyboard';
import { formatAdminCallback } from '../access.domain';

/**
 * Карточка «Новая регистрация» для администраторов.
 *
 * Пересылки сообщений между админом и пользователем здесь нет намеренно: в
 * карточке есть @ник, Telegram делает его кликабельным, и администратор пишет
 * пользователю напрямую. Релей потребовал бы хранить состояние диалога
 * («кому я сейчас отвечаю») и превратил бы бота в посредника без нужды.
 *
 * Отправляем через ctx.telegram.sendMessage, а не через статический
 * TelegramApiService: тот не умеет reply_markup, а без кнопок карточка
 * бессмысленна.
 */
@Injectable()
export class AdminNotifierService {
  private readonly logger = new Logger(AdminNotifierService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly keyboard: PriceChangerKeyboard,
    private readonly accessService: UserAccessService,
  ) {}

  /**
   * Разослать заявку всем администраторам.
   * @returns сколько администраторов её получили.
   */
  public async sendApplication(
    ctx: Context,
    access: UserAccessDocument,
    store: YandexMarketDocument,
  ): Promise<number> {
    const text = this.renderCard(access, store);
    const keyboard = await this.keyboard.createInlineKeyboardMatrix([
      [
        {
          text: '✅ Одобрить',
          callback_data: formatAdminCallback('approve', access.telegramUserId),
        },
        {
          text: '⛔ Отклонить',
          callback_data: formatAdminCallback('reject', access.telegramUserId),
        },
      ],
    ]);

    const cards: IAdminCard[] = [];
    for (const adminId of this.config.telegramAdminIds) {
      try {
        const sent = await ctx.telegram.sendMessage(
          adminId,
          text,
          htmlOptions({ reply_markup: keyboard.reply_markup }),
        );
        cards.push({
          adminId: adminId.toString(),
          chatId: sent.chat.id,
          messageId: sent.message_id,
        });
      } catch (error) {
        // Типовая причина — администратор не нажимал /start у бота, и Telegram
        // отвечает 403: бот не может написать первым. Один недоступный админ
        // не должен срывать доставку остальным.
        this.logger.error(`Не удалось отправить заявку администратору ${adminId}`, error as Error);
      }
    }

    if (cards.length) {
      await this.accessService.attachAdminCards(access.telegramUserId, access.botId, cards);
    }

    return cards.length;
  }

  /**
   * Перерисовать карточки после решения: свою — через ctx, остальные — по
   * сохранённым message_id. reply_markup не передаём, поэтому кнопки исчезают.
   */
  public async finalizeCards(
    ctx: Context,
    access: UserAccessDocument,
    store: YandexMarketDocument | null,
  ): Promise<void> {
    const text = this.renderCard(access, store) + '\n\n' + this.renderVerdict(access);

    try {
      await ctx.editMessageText(text, htmlOptions());
    } catch (error) {
      this.logger.warn(`Не удалось обновить карточку инициатора: ${error}`);
    }

    const own = ctx.callbackQuery?.message?.message_id;
    for (const card of access.adminCards ?? []) {
      if (card.messageId === own) continue;
      try {
        await ctx.telegram.editMessageText(
          card.chatId,
          card.messageId,
          undefined,
          text,
          htmlOptions(),
        );
      } catch (error) {
        // «message is not modified» и «message to edit not found» (админ удалил
        // сообщение) — штатные исходы, а не сбой обработки решения.
        this.logger.warn(`Не удалось обновить карточку у администратора ${card.adminId}: ${error}`);
      }
    }
  }

  /**
   * Тело карточки. Всё, что пришло от пользователя, экранируется: символ `<`
   * в имени ломает разметку всего сообщения и даёт 400 от Telegram.
   */
  public renderCard(access: UserAccessDocument, store: YandexMarketDocument | null): string {
    const name = [access.firstName, access.lastName].filter(Boolean).join(' ');

    // Telegram сам делает @ник кликабельным — это и есть весь механизм связи
    // администратора с пользователем. Без ника остаётся tg://user?id=, который
    // открывается не во всех клиентах, поэтому рядом печатаем сырой id.
    const contact = access.username
      ? `@${esc(access.username)}`
      : `<a href="tg://user?id=${access.telegramUserId}">написать</a>`;

    return [
      '🆕 <b>Новая регистрация</b>',
      '',
      `👤 <b>Имя:</b> ${esc(name) || '—'}`,
      `🔗 <b>Связь:</b> ${contact}`,
      `🆔 <b>ID:</b> <code>${esc(access.telegramUserId)}</code>`,
      '',
      '<b>Магазин Яндекс.Маркета</b>',
      `🔑 Campaign ID: <code>${esc(store?.campaign_id) || '—'}</code>`,
      `🏢 Business ID: <code>${esc(store?.business_id) || '—'}</code>`,
      // Токен продавца — секрет. В карточку идёт только начало, чтобы админ мог
      // сверить его с тем, что видит у себя, но не более того.
      `🎫 Токен: <code>${esc(store?.token?.slice(0, 10)) || '—'}…</code>`,
    ].join('\n');
  }

  private renderVerdict(access: UserAccessDocument): string {
    const who = access.decidedByUsername
      ? `@${esc(access.decidedByUsername)}`
      : `<code>${esc(access.decidedBy)}</code>`;
    const when = (access.approvedAt ?? access.rejectedAt ?? new Date()).toLocaleString('ru-RU');

    return access.status === 'approved'
      ? `✅ <b>Одобрено</b> ${who}, ${esc(when)}`
      : `⛔ <b>Отклонено</b> ${who}, ${esc(when)}`;
  }
}
