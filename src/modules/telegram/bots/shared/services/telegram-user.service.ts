import { Injectable, Logger } from '@nestjs/common';
import { User } from '@telegraf/types/manage';
import { Context } from 'telegraf';
import { SubscriptionService } from '../../../../../database/services/subscription.service';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { SubscriptionDocument } from '../../../../../database/schemas/subscription.schema';
import { YandexMarketDocument } from '../../../../../database/schemas/yandex-market.schema';

/**
 * Синглтон: экземпляра Telegraf больше не держит. Идентификатор бота
 * приходит параметром (в хендлерах это `ctx.botInfo.id`) — раньше ради него
 * на каждый вызов делался `bot.telegram.getMe()`.
 *
 * Класс-декоратор `@DecorateMethodsWith(TryCatch())` снят (TASK-013): он
 * ГЛОТАЛ все исключения и возвращал undefined. Из-за этого checkUserSubscription
 * отдавал undefined, а вызывающий код падал на `.hasActiveSubscription`
 * с невнятным TypeError вместо настоящей ошибки.
 */
@Injectable()
export class TelegramUserService {
  private readonly logger = new Logger(TelegramUserService.name);

  constructor(
    private subscriptionService: SubscriptionService,
    private yandexMarketService: YandexMarketService,
  ) {}

  public async handleUser(telegramUser: User, botId: number) {
    try {
      let userSubscription = await this.subscriptionService.findByUserAndChat(
        telegramUser.id,
        botId
      );
      if (!userSubscription) {
        userSubscription = await this.subscriptionService.createSubscription({
          user_id: telegramUser.id,
          chat_id: botId,
          plan: 'week',
          last_payment_amount: 0,
        });
      }
      return userSubscription;
    } catch (error) {
      this.logger.error('handleUser: не удалось получить или создать подписку', error);
      throw error; // не глушим — выше есть bot.catch
    }
  }

  public async handleUserYandexStore(
    userSubscription: SubscriptionDocument,
    botId: number,
  ): Promise<YandexMarketDocument> {
    let yandexStore = await this.yandexMarketService.findByTelegramUser(
      userSubscription.user_id.toString()
    );
    if (!yandexStore) {
      yandexStore = await this.yandexMarketService.create({
        telegramUserId: userSubscription.user_id.toString(),
        telegramChatId: botId.toString(),
      });
    }
    return yandexStore;
  }

  public async checkUserSubscription(telegramUser: User, botId: number): Promise<{
    hasActiveSubscription: boolean;
    subscription?: any;
  }> {
    const isActive = await this.subscriptionService.isSubscriptionActive(
      telegramUser.id,
      botId,
    );
    if (isActive) {
      const subscription = await this.subscriptionService.findByUserAndChat(
        telegramUser.id,
        botId
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