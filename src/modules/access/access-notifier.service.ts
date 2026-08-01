import type { UserAccessDocument } from '../../database/schemas/user-access.schema';

import { Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '../../config/app-config.service';
import { BotRegistry } from '../telegram/bots/bot-registry.service';
import {
  ACCESS_GRANTED_TEXT,
  ACCESS_REVOKED_TEXT,
} from '../telegram/bots/price-changer-bot/access-decision.text';
import { PriceChangerKeyboard } from '../telegram/bots/price-changer-bot/price-changer.keyboard';
import { htmlOptions } from '../telegram/formatting/telegram-format';

/**
 * Сообщить продавцу, что доступ открыли или закрыли из веб-панели.
 *
 * Зачем это здесь вообще. Тот же переключатель в Telegram («⛔ Закрыть доступ»,
 * кнопки карточки заявки) продавца уведомляет всегда, и молчаливое отключение
 * уже описано в коде как поломка с точки зрения пользователя: бот внезапно
 * перестал отвечать, и человек приходит разбираться именно как с поломкой.
 * Панель, которая делает то же самое молча, вернула бы ровно эту проблему.
 *
 * Тексты берутся из `access-decision.text.ts` — общего модуля с телеграм-
 * обработчиками. Своя копия здесь означала бы, что продавец читает разные
 * объяснения одного события в зависимости от того, откуда админ нажал.
 */
@Injectable()
export class AccessNotifierService {
  private readonly logger = new Logger(AccessNotifierService.name);

  constructor(
    private readonly registry: BotRegistry,
    private readonly keyboard: PriceChangerKeyboard,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Никогда не бросает.
   *
   * Продавец мог заблокировать бота, а бот — не быть поднятым в этом процессе
   * (панель работает и без Telegram). Ни то, ни другое не повод считать смену
   * статуса неудавшейся: она уже записана в базу, и ошибка здесь означала бы
   * ответ «не получилось» на успешно выполненное действие.
   */
  async notify(access: UserAccessDocument, approved: boolean): Promise<void> {
    try {
      const bot = this.registry.findByTelegramId(access.botId);
      if (!bot) {
        this.logger.warn(`Бот ${access.botId} не зарегистрирован — уведомление пропущено`);
        return;
      }

      if (!approved) {
        await bot.telegraf.telegram.sendMessage(access.telegramChatId, ACCESS_REVOKED_TEXT);
        return;
      }

      // Раскладка собирается для ПОЛУЧАТЕЛЯ: и права администратора, и его
      // набор открытых возможностей — его собственные, а не того, кто нажал
      // тумблер в панели.
      const kb = await this.keyboard.createMenuKeyboard(
        this.config.isAdmin(access.telegramUserId),
        access.features,
      );
      await bot.telegraf.telegram.sendMessage(
        access.telegramChatId,
        ACCESS_GRANTED_TEXT,
        htmlOptions(kb),
      );
    } catch (error) {
      this.logger.warn(
        `Не удалось уведомить ${access.telegramUserId} о смене доступа: ${String(error)}`,
      );
    }
  }
}
