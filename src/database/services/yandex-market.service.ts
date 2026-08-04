import type { TRateField } from '../../modules/yandex/reports/profit';
import type { TPromoConfig } from '../../modules/yandex/reports/promo';

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { isBrandKey, type TBrandKey } from '../../modules/yandex/reports/brands';
import {
  YandexMarket,
  YandexMarketDocument,
  type IStoreEntry,
} from '../schemas/yandex-market.schema';

export interface CreateYandexMarketDto {
  campaign_id?: string;
  business_id?: string;
  token?: string;
  priceCoefficient?: number;
  /** Комиссия Маркета, % — для расчёта прибыли. */
  commissionPercent?: number;
  /** Налог с продаж, % — для расчёта прибыли. */
  taxPercent?: number;
  /** Скидка от цены прайса, % — из неё получается закуп. */
  discountPercent?: number;
  name?: string;
  telegramUserId?: string;
  telegramChatId?: string;
}

export interface UpdateYandexMarketDto {
  campaign_id?: string;
  business_id?: string;
  token?: string;
  priceCoefficient?: number;
  commissionPercent?: number;
  taxPercent?: number;
  discountPercent?: number;
  name?: string;
  stores?: IStoreEntry[];
}

@Injectable()
export class YandexMarketService {
  constructor(
    @InjectModel(YandexMarket.name)
    private readonly yandexMarketModel: Model<YandexMarketDocument>,
  ) {}

  /**
   * Создать новую запись Яндекс Маркета
   */
  async create(data: CreateYandexMarketDto): Promise<YandexMarketDocument> {
    const yandexMarket = new this.yandexMarketModel({
      ...data,
      created_at: new Date(),
      updated_at: new Date(),
    });

    return await yandexMarket.save();
  }

  /**
   * Найти по Telegram пользователю
   */
  async findByTelegramUser(telegramUserId: string): Promise<YandexMarketDocument | null> {
    return await this.yandexMarketModel.findOne({ telegramUserId }).exec();
  }

  /**
   * Найти по Telegram чату
   */
  async findByTelegramChat(telegramChatId: string): Promise<YandexMarketDocument | null> {
    return await this.yandexMarketModel.findOne({ telegramChatId }).exec();
  }

  /**
   * Найти по ID кампании
   */
  async findByCampaignId(campaign_id: string): Promise<YandexMarketDocument | null> {
    return await this.yandexMarketModel.findOne({ campaign_id }).exec();
  }

  /**
   * Найти по ID бизнеса
   */
  async findByBusinessId(business_id: string): Promise<YandexMarketDocument | null> {
    return await this.yandexMarketModel.findOne({ business_id }).exec();
  }

  /**
   * Обновить по Telegram пользователю
   */
  async updateByTelegramUser(
    telegramUserId: string,
    data: UpdateYandexMarketDto,
  ): Promise<YandexMarketDocument | null> {
    return await this.yandexMarketModel
      .findOneAndUpdate(
        { telegramUserId },
        {
          ...data,
          updated_at: new Date(),
        },
        { new: true },
      )
      .exec();
  }

  /**
   * Создать или обновить по Telegram пользователю
   */
  async upsertByTelegramUser(
    telegramUserId: string,
    telegramChatId: string,
    data: UpdateYandexMarketDto,
  ): Promise<YandexMarketDocument> {
    const existing = await this.findByTelegramUser(telegramUserId);

    if (existing) {
      // Без non-null assertion: документ только что был найден, но между
      // find и update его мог удалить параллельный запрос — тогда честнее
      // вернуть найденный ранее, чем утверждать, что null не бывает.
      const updated = await this.updateByTelegramUser(telegramUserId, data);
      return updated ?? existing;
    } else {
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
  async updatePriceCoefficient(
    telegramUserId: string,
    coefficient: number,
  ): Promise<YandexMarketDocument | null> {
    return await this.updateByTelegramUser(telegramUserId, {
      priceCoefficient: coefficient,
    });
  }

  /**
   * Обновить одну ставку расчёта прибыли (комиссия или налог).
   *
   * Отдельный метод, а не вычисляемый ключ на месте вызова: `{[field]: value}`
   * с полем-объединением теряет типизацию, и опечатка в имени поля молча
   * записала бы в документ лишнее.
   */
  async updateRate(
    telegramUserId: string,
    // Тип берётся из profit.ts, где объявлены и сами ставки: здесь стояла
    // ВТОРАЯ копия того же объединения из четырёх строк, а такие копии в этом
    // проекте уже расходились (`priceCoefficient` — в четырёх местах).
    field: TRateField,
    value: number,
  ): Promise<YandexMarketDocument | null> {
    // Перечисление по одному варианту, а не `{[field]: value}`: вычисляемый ключ
    // с полем-объединением теряет типизацию, и опечатка в имени поля молча
    // записала бы в документ лишнее поле вместо настройки.
    const data: UpdateYandexMarketDto = {};
    if (field === 'commissionPercent') data.commissionPercent = value;
    if (field === 'taxPercent') data.taxPercent = value;
    if (field === 'discountPercent') data.discountPercent = value;

    return await this.updateByTelegramUser(telegramUserId, data);
  }

  /**
   * Записать скидку одного бренда, % — в карту `brandDiscounts`.
   *
   * НЕ через DTO/updateByTelegramUser: запись идёт по dot-path
   * (`brandDiscounts.vostok`), а не полем документа, — иначе `$set` целой карты
   * стирал бы скидки остальных брендов при параллельной правке.
   *
   * Белый список обязателен и несущий: ключ уходит в путь `$set`, то есть
   * решает, КУДА писать в документе, — тот же довод, что у `setFeature`.
   */
  async updateBrandDiscount(
    telegramUserId: string,
    brand: TBrandKey,
    value: number,
  ): Promise<YandexMarketDocument | null> {
    if (!isBrandKey(brand)) {
      throw new Error(`Недопустимый бренд: ${brand}`);
    }

    return await this.yandexMarketModel
      .findOneAndUpdate(
        { telegramUserId },
        {
          $set: {
            [`brandDiscounts.${brand}`]: value,
            updatedAt: new Date(),
          },
        },
        { new: true },
      )
      .exec();
  }

  /**
   * Записать настройку продвижения одного бренда — в карту `promoCommissions`.
   *
   * Те же правила, что у `updateBrandDiscount`: dot-path вместо `$set` целой
   * карты (параллельная правка другого бренда не должна стирать эту) и несущий
   * белый список — ключ решает, КУДА писать в документе.
   *
   * `config === null` — «отключить»: запись снимается `$unset`, а не нулём,
   * потому что «продвижения нет» и «продвижение 0 %» — разные утверждения, и
   * экран должен показывать «—», а не «0%».
   */
  async updatePromoCommission(
    telegramUserId: string,
    brand: TBrandKey,
    config: TPromoConfig | null,
  ): Promise<YandexMarketDocument | null> {
    if (!isBrandKey(brand)) {
      throw new Error(`Недопустимый бренд: ${brand}`);
    }

    const update =
      config === null
        ? {
            $unset: { [`promoCommissions.${brand}`]: '' },
            $set: { updatedAt: new Date() },
          }
        : {
            $set: {
              [`promoCommissions.${brand}`]: config,
              updatedAt: new Date(),
            },
          };

    return await this.yandexMarketModel
      .findOneAndUpdate({ telegramUserId }, update, { new: true })
      .exec();
  }

  /**
   * Проверить настроен ли аккаунт
   *
   * Проверяются РОВНО три креда и ничего больше. Добавить сюда ставки прибыли
   * нельзя: этим же методом маршрутизируется свободный текст одобренного
   * пользователя, и «магазин не настроен» отправило бы его обратно в визард.
   */
  async isConfigured(telegramUserId: string): Promise<boolean> {
    const config = await this.findByTelegramUser(telegramUserId);
    return !!(config && config.campaign_id && config.business_id && config.token);
  }

  /**
   * Магазины сразу многих продавцов — ОДНИМ запросом.
   *
   * Нужен списку пользователей в панели. Звать `isConfigured` в цикле, как это
   * делает админский список в Telegram, там нельзя: на полусотне продавцов это
   * полсотни последовательных запросов ради одной галочки в таблице.
   */
  async findByTelegramUsers(telegramUserIds: string[]): Promise<YandexMarketDocument[]> {
    if (telegramUserIds.length === 0) return [];
    return await this.yandexMarketModel.find({ telegramUserId: { $in: telegramUserIds } }).exec();
  }

  /**
   * Получить по Telegram пользователю
   */
  async getByTelegramUser(telegramUserId: string): Promise<YandexMarketDocument | null> {
    return await this.findByTelegramUser(telegramUserId);
  }

  /**
   * Удалить по Telegram пользователю
   */
  async deleteByTelegramUser(telegramUserId: string): Promise<boolean> {
    const result = await this.yandexMarketModel.deleteOne({ telegramUserId }).exec();
    return result.deletedCount > 0;
  }

  /**
   * Получить все записи
   */
  async getAll(): Promise<YandexMarketDocument[]> {
    return await this.yandexMarketModel.find().exec();
  }

  /**
   * Валидация данных
   */
  validateData(data: CreateYandexMarketDto): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (data.campaign_id && !/^\d+$/.test(data.campaign_id)) {
      errors.push('campaign_id должен содержать только цифры');
    }

    if (data.business_id && !/^\d+$/.test(data.business_id)) {
      errors.push('business_id должен содержать только цифры');
    }

    if (data.token && data.token.length < 10) {
      errors.push('token слишком короткий');
    }

    if (data.priceCoefficient && (data.priceCoefficient <= 0 || data.priceCoefficient > 10)) {
      errors.push('priceCoefficient должен быть между 0 и 10');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}
