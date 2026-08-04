import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';

import { AppConfigService } from '../../../../../config/app-config.service';
import { htmlOptions } from '../../../formatting/telegram-format';
import { PriceChangerKeyboard } from '../../price-changer-bot/price-changer.keyboard';

/**
 * Единый ответ «сначала подключите магазин».
 *
 * Зачем сервис, а не строка в каждом хендлере. Reply-клавиатура в Telegram
 * персистентна: у продавца (в первую очередь у администратора, который минует
 * гейт доступа) без подключённого магазина на экране остаётся полное меню
 * отчётов, а каждая кнопка ведёт в тупик «заполните настройки». Просто ответить
 * текстом клавиатуру не меняет. Поэтому на КАЖДОЙ стене «нужен магазин» надо ещё
 * и сбросить залипшее меню на сокращённое — и делать это в ОДНОМ месте, иначе
 * стены разъедутся (та же причина, ради которой существует menu.constants).
 *
 * `createUnconfiguredKeyboard(isAdmin)` отдаёт «⚙️ Настройки» + «❓ Помощь»
 * (+ ряд «👥 Пользователи» у администратора) — ровно то, что нужно без магазина.
 */
@Injectable()
export class StorePromptService {
  constructor(
    private readonly keyboard: PriceChangerKeyboard,
    private readonly config: AppConfigService,
  ) {}

  public async replyNeedsStore(ctx: Context): Promise<void> {
    const kb = await this.keyboard.createUnconfiguredKeyboard(this.config.isAdmin(ctx.from.id));
    await ctx.reply('⚠️ Сначала заполните настройки API.', htmlOptions(kb));
  }
}
