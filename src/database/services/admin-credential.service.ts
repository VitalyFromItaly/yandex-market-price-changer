import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { Model } from 'mongoose';

import {
  ADMIN_CREDENTIAL_KEY,
  AdminCredential,
  AdminCredentialDocument,
} from '../schemas/admin-credential.schema';

/** Длина генерируемого пароля в символах. */
const PASSWORD_LENGTH = 24;

/**
 * Стоимость bcrypt. 12 — заметно дороже дефолтных 10 при том, что проверка
 * происходит раз в неделю на вход, а не на каждый запрос: подбор офлайн-копии
 * хеша дорожает вчетверо, а человек разницы не замечает.
 */
const BCRYPT_ROUNDS = 12;

/** Алфавит пароля без похожих символов: его читают глазами из логов CapRover. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

@Injectable()
export class AdminCredentialService {
  private readonly logger = new Logger(AdminCredentialService.name);

  constructor(
    @InjectModel(AdminCredential.name)
    private readonly model: Model<AdminCredentialDocument>,
  ) {}

  /**
   * Завести учётные данные, если их ещё нет.
   *
   * Пароль печатается в консоль ровно один раз — в момент генерации. Печатать
   * его на каждом старте нельзя: логи контейнера видит всякий, у кого есть
   * доступ к панели CapRover, и пароль, повторяющийся в каждом запуске, живёт
   * в истории логов вечно.
   *
   * Возвращает сгенерированный пароль или null, если документ уже был, — чтобы
   * вызывающий не гадал, было ли что показывать.
   */
  async ensure(): Promise<string | null> {
    const existing = await this.model.findOne({ key: ADMIN_CREDENTIAL_KEY }).exec();
    if (existing) return null;

    const password = this.generatePassword();

    try {
      await this.model.create({
        key: ADMIN_CREDENTIAL_KEY,
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
        jwtSecret: randomBytes(48).toString('hex'),
      });
    } catch (error) {
      // 11000 — уникальный индекс: параллельный старт успел раньше. Это не
      // сбой, но показывать НАШ пароль нельзя: в базе лежит хеш чужого.
      if ((error as { code?: number }).code === 11000) {
        this.logger.warn('Учётные данные админ-панели уже созданы другим экземпляром');
        return null;
      }
      throw error;
    }

    this.announce(password);
    return password;
  }

  async find(): Promise<AdminCredentialDocument | null> {
    return await this.model.findOne({ key: ADMIN_CREDENTIAL_KEY }).exec();
  }

  /**
   * Пароль в консоль — блоком, а не строкой.
   *
   * Он появляется ровно один раз среди сотен строк старта Nest, и пропустить
   * его означает потерять доступ к панели до удаления документа из базы.
   */
  private announce(password: string): void {
    const line = '═'.repeat(64);
    this.logger.log(
      [
        '',
        line,
        '  ПАРОЛЬ АДМИН-ПАНЕЛИ (показывается ОДИН РАЗ, сохраните сейчас)',
        '',
        `      ${password}`,
        '',
        '  Логин — ваш Telegram id из TELEGRAM_ADMIN_IDS.',
        '  Забыли пароль? Удалите документ из коллекции admincredentials',
        '  и перезапустите приложение — будет сгенерирован новый.',
        line,
        '',
      ].join('\n'),
    );
  }

  /**
   * Случайный пароль без предвзятости по модулю.
   *
   * `byte % ALPHABET.length` распределён неравномерно, когда 256 не делится на
   * длину алфавита: первые символы выпадают чаще. Здесь байты вне последнего
   * полного диапазона отбрасываются.
   */
  private generatePassword(): string {
    const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
    let password = '';

    while (password.length < PASSWORD_LENGTH) {
      for (const byte of randomBytes(PASSWORD_LENGTH)) {
        if (byte >= limit) continue;
        password += ALPHABET[byte % ALPHABET.length];
        if (password.length === PASSWORD_LENGTH) break;
      }
    }

    return password;
  }
}
