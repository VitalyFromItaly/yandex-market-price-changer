import type { IReminderRecipient } from '../../bots/price-changer-bot/hosting-reminder';

import { Injectable } from '@nestjs/common';

import { UserAccessService } from '../../../../database/services/user-access.service';
import { YandexMarketService } from '../../../../database/services/yandex-market.service';
import { BotRegistry } from '../../bots/bot-registry.service';
import { pickRecipients } from '../../bots/price-changer-bot/hosting-reminder';

/** Получатель напоминания с указанием, чей это бот. */
export interface IReminderRow extends IReminderRecipient {
  botId: string;
}

/**
 * Кому уйдёт напоминание об оплате хостинга.
 *
 * Отдельный сервис, потому что вопрос задают ДВОЕ: процессор (перед отправкой)
 * и админ-панель (карточка «кому уйдёт» и подтверждение перед ручным запуском).
 * Вторая копия отбора разъехалась бы с первой молча — панель показывала бы одно,
 * а рассылка уходила другим; ровно эта беда уже случалась со справкой и
 * настройками, и ради неё в проекте заведено правило «один экран — один текст».
 *
 * Само правило отбора здесь не живёт: оно в чистой `pickRecipients`, которую
 * можно проверить таблицей случаев. Здесь только доступ к данным.
 */
@Injectable()
export class HostingReminderService {
  constructor(
    private readonly registry: BotRegistry,
    private readonly access: UserAccessService,
    private readonly yandexMarketService: YandexMarketService,
  ) {}

  /** Получатели одного бота. */
  public async recipientsFor(botId: string): Promise<IReminderRecipient[]> {
    const accounts = await this.access.listByBot(botId);
    if (!accounts.length) return [];

    // Магазины — ОДНИМ запросом по списку id, а не isConfigured на строку
    // (приём AccessController). Токен нужен как признак подключения, не сам по
    // себе: продавец без него ботом не пользуется.
    const stores = await this.yandexMarketService.findByTelegramUsers(
      accounts.map((account) => account.telegramUserId),
    );
    const configured = new Set(
      stores
        .filter((store) => store.campaign_id && store.business_id && store.token)
        .map((store) => store.telegramUserId),
    );

    return pickRecipients(accounts, configured);
  }

  /**
   * Получатели всех поднятых ботов.
   *
   * `all()`, а не `first()`: при двух арендаторах панель показывала бы половину
   * списка, а рассылка уходила всем — расхождение, которое ищут часами.
   */
  public async recipients(): Promise<IReminderRow[]> {
    const rows: IReminderRow[] = [];

    for (const bot of this.registry.all()) {
      const botId = bot.telegramId.toString();
      for (const recipient of await this.recipientsFor(botId)) {
        rows.push({ ...recipient, botId });
      }
    }

    return rows;
  }
}
