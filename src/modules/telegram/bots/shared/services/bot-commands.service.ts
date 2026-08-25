import type { UserAccessDocument } from '../../../../../database/schemas/user-access.schema';
import type { TCommandScope } from '../../price-changer-bot/bot-commands';
import type { Telegram } from 'telegraf';

import { Injectable, Logger } from '@nestjs/common';

import { UserAccessService } from '../../../../../database/services/user-access.service';
import { commandsFor, scopeForStatus } from '../../price-changer-bot/bot-commands';

/**
 * Персональный список команд чата — синяя кнопка «Меню» слева от поля ввода.
 *
 * Зачем персонально. Список, поставленный `setMyCommands` без scope, достаётся
 * ВСЕМ: человек без доступа видел /menu, /settings, /profile, /help, нажимал и
 * получал «Сначала нужно подать заявку на доступ». Кнопки, ведущие в отказ, —
 * ровно то, чего в интерфейсе быть не должно (довод `MENU_LAYOUT_UNCONFIGURED`
 * и `featureMenuLayout`). Теперь умолчание бота — гостевой список (`/start`), а
 * полный ставится персонально одобренному и снимается при закрытии доступа.
 *
 * Почему `commandScope` хранится в `UserAccess`, а не считается каждый раз. Это
 * НЕ второй статус доступа, а память о том, что уже отправлено в Telegram: без
 * неё пришлось бы звать Bot API на каждом апдейте, чтобы «на всякий случай»
 * подтвердить список. С ней в установившемся состоянии запросов ноль, а уже
 * одобренные пользователи доберут полный список на своём следующем апдейте —
 * без миграции.
 *
 * Ни один метод не бросает и не обязан ожидаться вызывающим: список команд не
 * имеет права помешать боту ответить (политика `ActionLogService.record`).
 */
@Injectable()
export class BotCommandsService {
  private readonly logger = new Logger(BotCommandsService.name);

  /**
   * Чаты администраторов, которым полный список уже поставлен в этом процессе.
   *
   * Записи `UserAccess` у администратора нет вовсе (гейт пропускает его раньше
   * `ensure`), поэтому запомнить отправленное негде — кроме памяти. После
   * рестарта список поставится заново на первом же /start; администраторов
   * единицы, лишний вызов ничего не стоит.
   */
  private readonly adminSynced = new Set<string>();

  constructor(private readonly accessService: UserAccessService) {}

  /**
   * Привести список команд чата к статусу доступа. Ничего не делает, если
   * нужный список уже отправлен.
   */
  public async syncForUser(telegram: Telegram, access: UserAccessDocument): Promise<void> {
    const desired = scopeForStatus(access.status);
    if (access.commandScope === desired) return;

    const pushed = await this.push(telegram, access.telegramChatId, desired);
    if (!pushed) return;

    try {
      await this.accessService.setCommandScope(access.telegramUserId, access.botId, desired);
    } catch (error) {
      // Не записали — на следующем апдейте просто попробуем ещё раз. Список у
      // пользователя при этом уже правильный.
      this.logger.warn(`Не удалось запомнить список команд ${access.telegramUserId}: ${error}`);
    }
  }

  /** Полный список администратору: своей записи доступа у него нет. */
  public async syncForAdmin(telegram: Telegram, botId: string, chatId: string): Promise<void> {
    const key = `${botId}:${chatId}`;
    if (this.adminSynced.has(key)) return;

    if (await this.push(telegram, chatId, 'full')) {
      this.adminSynced.add(key);
    }
  }

  /**
   * Отправить список в Telegram.
   *
   * Гостевой ставится УДАЛЕНИЕМ персонального списка, а не отправкой копии
   * умолчания: чат возвращается к умолчанию бота, и правка умолчания в
   * `setupBotCommands` не оставляет за собой чаты со старой копией.
   */
  private async push(telegram: Telegram, chatId: string, scope: TCommandScope): Promise<boolean> {
    const chatScope = { type: 'chat', chat_id: Number(chatId) } as const;

    try {
      if (scope === 'guest') {
        await telegram.deleteMyCommands({ scope: chatScope });
      } else {
        await telegram.setMyCommands(commandsFor(scope), { scope: chatScope });
      }
      return true;
    } catch (error) {
      // Типовая причина — 403: пользователь заблокировал бота. Это не повод
      // считать смену статуса неудавшейся.
      this.logger.warn(`Не удалось поставить список команд чату ${chatId}: ${error}`);
      return false;
    }
  }
}
