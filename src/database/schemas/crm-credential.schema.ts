import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CrmCredentialDocument = CrmCredential & Document;

/**
 * Пароль продавца для входа в CRM.
 *
 * Заводится ЛЕНИВО — при первом успешном входе стартовым паролем, а не
 * миграцией: в CRM пускают только тех, кто уже пользуется ботом, и учётка без
 * единого входа ничего не значит. Пока документа нет, вход сверяется со
 * стартовым паролем из `CRM_INITIAL_PASSWORD`.
 *
 * Ключ — только `telegramUserId`, без `botId`: магазин (`YandexMarket`) тоже
 * привязан к одному id, и два пароля у одного человека на разных ботах
 * открывали бы один и тот же магазин.
 */
@Schema({ timestamps: true })
export class CrmCredential {
  @Prop({ type: String, required: true })
  telegramUserId: string;

  /** bcrypt-хеш. Сам пароль не хранится нигде. */
  @Prop({ type: String, required: true })
  passwordHash: string;

  /**
   * Пароль всё ещё стартовый, общий для всех. Пока флаг стоит, CRM пускает
   * только на экран смены пароля: иначе чужой магазин открывал бы каждый, кто
   * знает ник продавца и общий пароль.
   */
  @Prop({ type: Boolean, required: true, default: true })
  mustChangePassword: boolean;

  /**
   * Момент установки текущего пароля. Он же версия пароля (`pwdv`) в токене:
   * смена пароля сдвигает дату, и все выданные раньше токены перестают
   * проходить проверку — без чёрного списка токенов.
   */
  @Prop({ type: Date, required: true })
  passwordChangedAt: Date;

  @Prop({ type: Date })
  lastLoginAt?: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const CrmCredentialSchema = SchemaFactory.createForClass(CrmCredential);

// Одна учётка на человека: гонка двух первых входов упрётся в индекс, а не
// заведёт два хеша, из которых половина входов невалидна.
CrmCredentialSchema.index({ telegramUserId: 1 }, { unique: true });
