import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AdminCredentialDocument = AdminCredential & Document;

/**
 * Ключ единственного документа.
 *
 * Коллекция на одну запись — приём осознанный: пароль общий для всех
 * администраторов (логином служит Telegram id), и заводить документ на каждого
 * значило бы хранить одно значение в N копиях, которые обязаны совпадать.
 * Фиксированный ключ + unique-индекс делают «второй документ» невозможным на
 * уровне базы, а не на уровне надежды.
 */
export const ADMIN_CREDENTIAL_KEY = 'admin';

/**
 * Учётные данные админ-панели: хеш пароля и секрет подписи JWT.
 *
 * Почему в Mongo, а не в переменных окружения. Требование — «сгенерировать при
 * деплое, если ещё нет, и показать один раз»: значение должно пережить рестарт,
 * иначе оно генерируется заново на каждый запуск и «один раз» превращается в
 * «каждый раз». Переменная окружения этого не даёт — её пришлось бы вписывать
 * руками, то есть придумывать пароль самому.
 *
 * Секрет JWT лежит здесь по той же причине, и это не мелочь: сгенерированный в
 * памяти, он разлогинивал бы всех администраторов при каждом редеплое.
 */
@Schema({ timestamps: true })
export class AdminCredential {
  @Prop({ type: String, required: true, default: ADMIN_CREDENTIAL_KEY })
  key: string;

  /** bcrypt-хеш. Сам пароль не хранится нигде и восстановлению не подлежит. */
  @Prop({ type: String, required: true })
  passwordHash: string;

  /** Секрет подписи JWT — случайный, живёт столько же, сколько пароль. */
  @Prop({ type: String, required: true })
  jwtSecret: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const AdminCredentialSchema = SchemaFactory.createForClass(AdminCredential);

// Ровно один документ: гонка двух одновременных стартов упрётся в индекс, а не
// заведёт вторую пару «пароль/секрет», из которых половина входов невалидна.
AdminCredentialSchema.index({ key: 1 }, { unique: true });
