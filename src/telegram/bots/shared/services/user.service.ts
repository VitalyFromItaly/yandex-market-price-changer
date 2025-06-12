import DecorateMethodsWith from '../../../../shared/decorators/DecorateWith';
import TryCatch from '../../../../shared/decorators/TryCatch';
import { User } from '@telegraf/types/manage';
import { Context } from 'telegraf';
import { createSubscriptionModel, EBotName, TTelegrafBot } from '../../../domain.telegram';

@DecorateMethodsWith(TryCatch())
export class TelegramUserService {
  private bot: TTelegrafBot;

  constructor(bot: TTelegrafBot) {
    this.bot = bot;
  }

  public async handleUser(telegramUser: User, instanceName: EBotName): Promise<any> {
    const subscriptionModel = createSubscriptionModel(instanceName);

    if (!subscriptionModel) {
      return null;
    }

    const botData = await this.bot.telegram.getMe();
    const payload = { user_id: telegramUser.id, chat_id: botData.id };


    // @ts-ignore
    let user = await subscriptionModel.findOne(payload);
    if (!user) {
      // @ts-ignore
      user = await subscriptionModel.create(payload);
      console.log(`Новый Юзер в боте ${instanceName}`, { user });
    }

    console.log(`Юзер в боте ${instanceName}`, { user });
    return user;
  }

  public static getUserAndChatId(context: Context): { user_id: number, chat_id: number } {
    return { user_id: context.from.id, chat_id: context.botInfo.id };
  }
}
