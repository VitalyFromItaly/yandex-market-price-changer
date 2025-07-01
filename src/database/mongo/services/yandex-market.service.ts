import { YandexMarketModel, IYandexMarketSchema } from '../models/yandex-market.model.mongo';

export interface IYandexMarketData {
  campaign_id?: string;
  business_id?: string;
  token?: string;
  priceCoefficient?: number;
  name?: string;
  telegramUserId?: string;
  telegramChatId?: string;
}

export interface IYandexMarketUpdate {
  campaign_id?: string;
  business_id?: string;
  token?: string;
  priceCoefficient?: number;
  name?: string;
}

export class YandexMarketService {
  /**
   * Создать новую запись Яндекс Маркета
   */
  static async create(data: IYandexMarketData): Promise<IYandexMarketSchema> {
    const yandexMarket = new YandexMarketModel({
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return await yandexMarket.save();
  }

  /**
   * Найти запись по ID пользователя Telegram
   */
  static async findByTelegramUser(telegramUserId: string): Promise<IYandexMarketSchema | null> {
    return YandexMarketModel.findOne({ telegramUserId });
  }

  /**
   * Найти запись по ID чата Telegram
   */
  static async findByTelegramChat(telegramChatId: string): Promise<IYandexMarketSchema | null> {
    return YandexMarketModel.findOne({ telegramChatId });
  }

  /**
   * Найти запись по campaign ID
   */
  static async findByCampaignId(campaign_id: string): Promise<IYandexMarketSchema | null> {
    return await YandexMarketModel.findOne({ campaign_id });
  }

  /**
   * Найти запись по business ID
   */
  static async findByBusinessId(business_id: string): Promise<IYandexMarketSchema | null> {
    return await YandexMarketModel.findOne({ business_id });
  }

  /**
   * Обновить запись по ID пользователя Telegram
   */
  static async updateByTelegramUser(
    telegramUserId: string,
    data: IYandexMarketUpdate
  ): Promise<IYandexMarketSchema | null> {
    return await YandexMarketModel.findOneAndUpdate(
      { telegramUserId },
      { ...data, updatedAt: new Date() },
      { new: true, upsert: false }
    );
  }

  /**
   * Создать или обновить запись для пользователя Telegram
   */
  static async upsertByTelegramUser(
    telegramUserId: string,
    telegramChatId: string,
    data: IYandexMarketUpdate
  ): Promise<IYandexMarketSchema> {
    const existingRecord = await this.findByTelegramUser(telegramUserId);

    if (existingRecord) {
      // Обновляем существующую запись
      Object.assign(existingRecord, {
        ...data,
        telegramChatId, // Обновляем также chat ID
        updatedAt: new Date(),
      });
      return await existingRecord.save();
    } else {
      // Создаем новую запись
      return await this.create({
        ...data,
        telegramUserId,
        telegramChatId,
      });
    }
  }

  /**
   * Обновить коэффициент цены
   */
  static async updatePriceCoefficient(
    telegramUserId: string,
    coefficient: number
  ): Promise<IYandexMarketSchema | null> {
    const yandexMarket = await this.findByTelegramUser(telegramUserId);
    if (!yandexMarket) return null;

    return await yandexMarket.updatePriceCoefficient(coefficient);
  }

  /**
   * Проверить, настроена ли запись (есть ли все необходимые данные)
   */
  static async isConfigured(telegramUserId: string): Promise<boolean> {
    const yandexMarket = await this.findByTelegramUser(telegramUserId);
    return yandexMarket ? yandexMarket.isConfigured() : false;
  }

  /**
   * Получить все данные для пользователя Telegram
   */
  static async getByTelegramUser(telegramUserId: string): Promise<IYandexMarketSchema | null> {
    return await this.findByTelegramUser(telegramUserId);
  }

  /**
   * Удалить запись по ID пользователя Telegram
   */
  static async deleteByTelegramUser(telegramUserId: string): Promise<boolean> {
    const result = await YandexMarketModel.deleteOne({ telegramUserId });
    return result.deletedCount > 0;
  }

  /**
   * Получить все записи (для админских функций)
   */
  static async getAll(): Promise<IYandexMarketSchema[]> {
    return await YandexMarketModel.find();
  }

  /**
   * Валидация данных перед сохранением
   */
  static validateData(data: IYandexMarketData): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (data.campaign_id && !/^\d+$/.test(data.campaign_id)) {
      errors.push('Campaign ID должен содержать только цифры');
    }

    if (data.business_id && !/^\d+$/.test(data.business_id)) {
      errors.push('Business ID должен содержать только цифры');
    }

    if (data.token && data.token.length < 10) {
      errors.push('Токен должен содержать минимум 10 символов');
    }

    if (data.priceCoefficient !== undefined) {
      if (data.priceCoefficient <= 0) {
        errors.push('Коэффициент цены должен быть больше 0');
      }
      if (data.priceCoefficient > 10) {
        errors.push('Коэффициент цены не может быть больше 10 (1000%)');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}
