import { Injectable } from '@nestjs/common';

import { TTelegrafBot } from '../../../domain.telegram';

/**
 * Catch-all. ОБЯЗАН регистрироваться ПОСЛЕДНИМ — иначе перехватит апдейты,
 * предназначенные конкретным обработчикам, и те молча перестанут работать.
 * Инвариант закреплён тестом на порядок в PriceChangerComposer.
 *
 * Команда /stop убрана намеренно: раньше ЛЮБОЙ пользователь мог остановить
 * бота для всех — bot.stop() без единой проверки прав. Управление жизненным
 * циклом — задача процесса, а не собеседника в чате.
 */
@Injectable()
export class FallbackHandler {
  public register(bot: TTelegrafBot) {
    bot.on('message', async (ctx) => {
      await ctx.reply('Не понимаю эту команду. Откройте меню или отправьте /help.');
    });
  }
}
