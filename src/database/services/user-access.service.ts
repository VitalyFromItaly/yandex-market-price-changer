import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  IAdminCard,
  UserAccess,
  UserAccessDocument,
} from '../schemas/user-access.schema';

/** Кто обратился к боту — всё, что нужно, чтобы завести запись доступа. */
export interface IAccessIdentity {
  telegramUserId: string;
  botId: string;
  telegramChatId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}

/** Кто принял решение по заявке. */
export interface IAdminIdentity {
  id: string;
  username?: string;
}

export type TDraftField = 'token' | 'campaign_id' | 'business_id';

/**
 * Белый список полей черновика. Имя поля попадает в ключ $set (`draft.<field>`),
 * поэтому оно НЕ может браться из пользовательского ввода напрямую.
 */
export const DRAFT_FIELDS: TDraftField[] = [
  'token',
  'campaign_id',
  'business_id',
];

/**
 * Доступ к боту.
 *
 * Каждый переход статуса — ОДИН findOneAndUpdate, где ожидаемый текущий статус
 * стоит в фильтре. Атомарности одного документа в MongoDB достаточно, чтобы
 * «первое решение побеждает» работало без блокировок, транзакций и Redis:
 * проигравший просто получит null.
 */
@Injectable()
export class UserAccessService {
  private readonly logger = new Logger(UserAccessService.name);

  constructor(
    @InjectModel(UserAccess.name)
    private readonly model: Model<UserAccessDocument>,
  ) {}

  /**
   * Найти или создать запись доступа, попутно освежив профиль пользователя
   * (ник и имя меняются, а в карточке заявки они должны быть актуальными).
   *
   * Именно upsert, а не find-then-create, как в YandexMarketService: два
   * сообщения подряд от одного пользователя обрабатываются параллельно, и
   * find-then-create в этом месте создаёт второй документ.
   */
  async ensure(identity: IAccessIdentity): Promise<UserAccessDocument> {
    const { telegramUserId, botId, ...profile } = identity;
    return await this.model
      .findOneAndUpdate(
        { telegramUserId, botId },
        {
          $set: profile,
          $setOnInsert: { status: 'new' },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  async findByUserAndBot(
    telegramUserId: string,
    botId: string,
  ): Promise<UserAccessDocument | null> {
    return await this.model.findOne({ telegramUserId, botId }).exec();
  }

  /** Сохранить один кред в черновик. */
  async saveDraftField(
    telegramUserId: string,
    botId: string,
    field: TDraftField,
    value: string,
  ): Promise<UserAccessDocument | null> {
    if (!DRAFT_FIELDS.includes(field)) {
      throw new Error(`Недопустимое поле черновика: ${field}`);
    }
    return await this.model
      .findOneAndUpdate(
        { telegramUserId, botId },
        { $set: { [`draft.${field}`]: value } },
        { new: true },
      )
      .exec();
  }

  /** Сбросить черновик — пользователь начинает визард заново. */
  async clearDraft(
    telegramUserId: string,
    botId: string,
  ): Promise<UserAccessDocument | null> {
    return await this.model
      .findOneAndUpdate(
        { telegramUserId, botId },
        { $unset: { draft: '' } },
        { new: true },
      )
      .exec();
  }

  /**
   * Подать заявку: new → pending.
   *
   * Возвращает null, если заявка уже подана. На этом и держится идемпотентность
   * уведомления администраторов: признаком новой заявки служит СМЕНА статуса, а
   * не факт заполненности кредов (заполненность истинна при каждом следующем
   * сохранении). Проверка живёт в базе, поэтому переживает и рестарт, и
   * параллельную обработку двух вебхуков.
   */
  async tryApply(
    telegramUserId: string,
    botId: string,
  ): Promise<UserAccessDocument | null> {
    return await this.model
      .findOneAndUpdate(
        { telegramUserId, botId, status: 'new' },
        {
          $set: { status: 'pending', appliedAt: new Date(), adminCards: [] },
          $unset: { draft: '' },
        },
        { new: true },
      )
      .exec();
  }

  /**
   * Откат заявки: pending → new. Нужен, когда карточку не удалось доставить ни
   * одному администратору — иначе пользователь навсегда зависнет в pending, а
   * узнать об этом будет некому.
   */
  async revertApply(
    telegramUserId: string,
    botId: string,
  ): Promise<UserAccessDocument | null> {
    return await this.model
      .findOneAndUpdate(
        { telegramUserId, botId, status: 'pending' },
        { $set: { status: 'new' }, $unset: { appliedAt: '', adminCards: '' } },
        { new: true },
      )
      .exec();
  }

  /** Запомнить, где лежат разосланные карточки, чтобы потом их отредактировать. */
  async attachAdminCards(
    telegramUserId: string,
    botId: string,
    cards: IAdminCard[],
  ): Promise<void> {
    await this.model
      .updateOne({ telegramUserId, botId }, { $set: { adminCards: cards } })
      .exec();
  }

  /**
   * Решение администратора: pending → approved | rejected.
   *
   * null означает, что кто-то уже решил (или заявки не было) — status:'pending'
   * в фильтре делает второе нажатие безопасным без всяких блокировок.
   */
  async decide(
    telegramUserId: string,
    botId: string,
    decision: 'approve' | 'reject',
    admin: IAdminIdentity,
  ): Promise<UserAccessDocument | null> {
    const now = new Date();
    const $set =
      decision === 'approve'
        ? {
            status: 'approved',
            approvedAt: now,
            decidedBy: admin.id,
            decidedByUsername: admin.username,
          }
        : {
            status: 'rejected',
            rejectedAt: now,
            decidedBy: admin.id,
            decidedByUsername: admin.username,
          };

    return await this.model
      .findOneAndUpdate(
        { telegramUserId, botId, status: 'pending' },
        { $set },
        { new: true },
      )
      .exec();
  }

  /**
   * Снять протухший отказ: rejected → new, если отказ старше cutoff.
   *
   * Лениво, при первом же обращении пользователя, без крона: ждать сброса,
   * кроме самого пользователя, некому. Срок ещё раз проверяется В ФИЛЬТРЕ,
   * поэтому два параллельных апдейта не сбросят статус дважды.
   */
  async expireRejection(
    telegramUserId: string,
    botId: string,
    cutoff: Date,
  ): Promise<UserAccessDocument | null> {
    return await this.model
      .findOneAndUpdate(
        {
          telegramUserId,
          botId,
          status: 'rejected',
          rejectedAt: { $lte: cutoff },
        },
        {
          $set: { status: 'new' },
          $unset: {
            rejectedAt: '',
            decidedBy: '',
            decidedByUsername: '',
            appliedAt: '',
            adminCards: '',
            draft: '',
          },
        },
        { new: true },
      )
      .exec();
  }

  /** Выдать доступ без заявки — для администраторов, которые сами продавцы. */
  async grant(identity: IAccessIdentity): Promise<UserAccessDocument> {
    const { telegramUserId, botId, ...profile } = identity;
    return await this.model
      .findOneAndUpdate(
        { telegramUserId, botId },
        {
          $set: { ...profile, status: 'approved', approvedAt: new Date() },
          $unset: { draft: '', rejectedAt: '' },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();
  }
}
