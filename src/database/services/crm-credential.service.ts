import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { CrmCredential, CrmCredentialDocument } from '../schemas/crm-credential.schema';

/**
 * Стоимость bcrypt — та же, что у пароля админ-панели (см. AdminCredentialService):
 * проверка идёт раз на вход, а не на каждый запрос.
 */
export const CRM_BCRYPT_ROUNDS = 12;

@Injectable()
export class CrmCredentialService {
  constructor(
    @InjectModel(CrmCredential.name)
    private readonly model: Model<CrmCredentialDocument>,
  ) {}

  async find(telegramUserId: string): Promise<CrmCredentialDocument | null> {
    return await this.model.findOne({ telegramUserId }).exec();
  }

  /**
   * Учётка со стартовым паролем при первом входе.
   *
   * `$setOnInsert` + upsert, а не create: два одновременных первых входа не
   * падают на уникальном индексе, и уже существующий (сменённый) пароль не
   * перезаписывается стартовым ни при каком раскладе. Возвращается то, что
   * реально лежит в базе, — токен подписывается его `passwordChangedAt`.
   */
  async createInitial(
    telegramUserId: string,
    passwordHash: string,
    at: Date,
  ): Promise<CrmCredentialDocument> {
    return await this.model
      .findOneAndUpdate(
        { telegramUserId },
        {
          $setOnInsert: {
            telegramUserId,
            passwordHash,
            mustChangePassword: true,
            passwordChangedAt: at,
          },
        },
        { upsert: true, new: true },
      )
      .exec();
  }

  /** Новый пароль: снимает обязательную смену и сдвигает версию пароля. */
  async changePassword(
    telegramUserId: string,
    passwordHash: string,
    at: Date,
  ): Promise<CrmCredentialDocument | null> {
    return await this.model
      .findOneAndUpdate(
        { telegramUserId },
        { $set: { passwordHash, mustChangePassword: false, passwordChangedAt: at } },
        { new: true },
      )
      .exec();
  }

  /**
   * Сброс из админ-панели: стартовый пароль, обязательная смена, новая версия
   * пароля. Без upsert — учётки нет, значит продавец в CRM не входил, и первый
   * вход и так будет со стартовым паролем.
   */
  async resetToInitial(
    telegramUserId: string,
    passwordHash: string,
    at: Date,
  ): Promise<CrmCredentialDocument | null> {
    return await this.model
      .findOneAndUpdate(
        { telegramUserId },
        { $set: { passwordHash, mustChangePassword: true, passwordChangedAt: at } },
        { new: true },
      )
      .exec();
  }

  async touchLogin(telegramUserId: string, at: Date): Promise<void> {
    await this.model.updateOne({ telegramUserId }, { $set: { lastLoginAt: at } }).exec();
  }
}
