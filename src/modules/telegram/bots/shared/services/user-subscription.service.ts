import { User } from '@telegraf/types/manage';
import { Context } from 'telegraf';
import { EBotName, TTelegrafBot } from '../../../domain.telegram';
import { SubscriptionService } from '../../../../../database/mongo/services/subscription.services';
import { YandexMarketModel } from '../../../../../database/mongo/models';
import { ISubscriptionSchema } from '../../../../../database/mongo/models/subscription.model.mongo';
import { IYandexMarketSchema } from '../../../../../database/mongo/models/yandex-market.model.mongo';

// @DecorateMethodsWith(TryCatch())
export class TelegramUserService {
  private bot: TTelegrafBot;

  constructor(bot: TTelegrafBot) {
    this.bot = bot;
  }

  // находит или создает подписку для пользователя
  public async handleUser(telegramUser: User) {
    const botData = await this.bot.telegram.getMe();
    const payload = { user_id: telegramUser.id, chat_id: botData.id };


    let userSubscription = await SubscriptionService.findByUserAndChat(payload);
    if (!userSubscription) {
      userSubscription = await SubscriptionService.createSubscription({
        ...payload,
        plan: 'week', // Default plan, can be changed later
        paymentAmount: 0, // Default amount, can be changed later
      });
    }

    return userSubscription;
  }

  public async handleUserYandexStore(userSubscription: ISubscriptionSchema): Promise<IYandexMarketSchema> {
    const botData = await this.bot.telegram.getMe();

    const yandexStore = await YandexMarketModel.findOne({
      telegramUserId: userSubscription.user_id,
      telegramChatId: botData.id,
    });

    if (yandexStore) {
      return yandexStore;
    }

    const newYandexStore = new YandexMarketModel({
      telegramUserId: userSubscription.user_id,
      telegramChatId: botData.id,
    });

    return await newYandexStore.save();
  }

  // Новый метод для проверки подписки пользователя
  public async checkUserSubscription(telegramUser: User): Promise<{
    hasActiveSubscription: boolean;
    subscription?: any;
  }> {
    const botData = await this.bot.telegram.getMe();
    const isActive = await SubscriptionService.isSubscriptionActive(
      telegramUser.id,
      botData.id,
    );

    if (isActive) {
      const subscription = await SubscriptionService.findByUserAndChat({
        user_id: telegramUser.id,
        chat_id: botData.id,
      });
      return { hasActiveSubscription: true, subscription };
    }

    return { hasActiveSubscription: false };
  }

  public static getUserAndChatId(context: Context): {
    user_id: number;
    chat_id: number;
  } {
    return { user_id: context.from.id, chat_id: context.botInfo.id };
  }
}
