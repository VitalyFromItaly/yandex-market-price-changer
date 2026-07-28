import DecorateMethodsWith from '../../../../../shared/decorators/DecorateWith';
import TryCatch from '../../../../../shared/decorators/TryCatch';
import { User } from '@telegraf/types/manage';
import { Context } from 'telegraf';
import { TTelegrafBot } from '../../../domain.telegram';
import { SubscriptionService } from '../../../../../database/services/subscription.service';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { SubscriptionDocument } from '../../../../../database/schemas/subscription.schema';
import { YandexMarketDocument } from '../../../../../database/schemas/yandex-market.schema';

@DecorateMethodsWith(TryCatch())
export class TelegramUserService {
  constructor(
    private bot: TTelegrafBot,
    private subscriptionService: SubscriptionService,
    private yandexMarketService: YandexMarketService
  ) {}

  public async handleUser(telegramUser: User) {
    try {
      const botData = await this.bot.telegram.getMe();
      let userSubscription = await this.subscriptionService.findByUserAndChat(
        telegramUser.id,
        botData.id
      );
      if (!userSubscription) {
        userSubscription = await this.subscriptionService.createSubscription({
          user_id: telegramUser.id,
          chat_id: botData.id,
          plan: 'week',
          last_payment_amount: 0,
        });
      }
      return userSubscription;
    } catch (error) {
      console.error('handleUser Ошибка при получении данных:', error);
      throw new Error('User not found or could not be created.');
    }
  }

  public async handleUserYandexStore(userSubscription: SubscriptionDocument): Promise<YandexMarketDocument> {
    const botData = await this.bot.telegram.getMe();
    let yandexStore = await this.yandexMarketService.findByTelegramUser(
      userSubscription.user_id.toString()
    );
    if (!yandexStore) {
      yandexStore = await this.yandexMarketService.create({
        telegramUserId: userSubscription.user_id.toString(),
        telegramChatId: botData.id.toString(),
      });
    }
    return yandexStore;
  }

  public async checkUserSubscription(telegramUser: User): Promise<{
    hasActiveSubscription: boolean;
    subscription?: any;
  }> {
    const botData = await this.bot.telegram.getMe();
    const isActive = await this.subscriptionService.isSubscriptionActive(
      telegramUser.id,
      botData.id,
    );
    if (isActive) {
      const subscription = await this.subscriptionService.findByUserAndChat(
        telegramUser.id,
        botData.id
      );
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