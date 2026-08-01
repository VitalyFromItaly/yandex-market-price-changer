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
   * Привести учётные данные в порядок при старте.
   *
   * Источников пароля два, и правило между ними одно: **`ADMIN_PASSWORD`
   * главнее**. Задан — он и есть пароль; не задан — прежнее поведение
   * (сгенерировать один раз и показать баннером).
   *
   * Порядок именно такой, а не «база главнее, env только для первого запуска»:
   * при обратном правиле правка переменной в CapRover не делала бы ничего, и
   * администратор менял бы пароль, который на самом деле не меняется. Здесь же
   * пароль в конфиге деплоя — это то, что реально работает после рестарта.
   *
   * Сверка пароля при этом остаётся ОДНА — bcrypt по хешу из базы. Второй путь
   * сравнения (со строкой из env напрямую) означал бы и второе место, где
   * можно ошибиться, и разное время ответа на двух ветках: `login()`
   * специально гоняет bcrypt даже для не-администратора, чтобы время ответа не
   * выдавало состав `TELEGRAM_ADMIN_IDS`.
   *
   * Возвращает сгенерированный пароль или null, если печатать нечего, — чтобы
   * вызывающий не гадал, было ли что показывать.
   */
  async ensure(envPassword?: string): Promise<string | null> {
    if (envPassword) {
      await this.applyEnvPassword(envPassword);
      return null;
    }
    return await this.generateIfMissing();
  }

  /**
   * Пароль из окружения.
   *
   * Хеш пересчитывается ТОЛЬКО когда он разошёлся с переменной: bcrypt со
   * стоимостью 12 — это ~0,3 с, и лишняя запись на каждом старте заодно
   * дёргала бы Mongo без повода. Обновляется при этом один `passwordHash`:
   * `jwtSecret` обязан пережить рестарт, иначе каждый деплой разлогинивал бы
   * всех администраторов.
   *
   * Сам пароль в лог не печатается: он и так у того, кто задал переменную, а
   * логи контейнера видит всякий, у кого есть доступ к CapRover.
   */
  private async applyEnvPassword(password: string): Promise<void> {
    const existing = await this.model.findOne({ key: ADMIN_CREDENTIAL_KEY }).exec();

    if (existing && (await bcrypt.compare(password, existing.passwordHash))) {
      this.logger.log('Пароль админ-панели берётся из ADMIN_PASSWORD');
      return;
    }

    try {
      await this.model
        .findOneAndUpdate(
          { key: ADMIN_CREDENTIAL_KEY },
          {
            $set: { passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS) },
            $setOnInsert: { jwtSecret: randomBytes(48).toString('hex') },
          },
          { upsert: true, new: true },
        )
        .exec();
    } catch (error) {
      // 11000 — параллельный старт успел вставить документ между нашими
      // findOne и upsert. Пароль у него тот же самый (переменная одна на все
      // экземпляры), так что делать ничего не нужно.
      if ((error as { code?: number }).code === 11000) {
        this.logger.warn('Учётные данные админ-панели созданы другим экземпляром');
        return;
      }
      throw error;
    }

    this.logger.log('Пароль админ-панели установлен из ADMIN_PASSWORD');
  }

  /**
   * Прежнее поведение: сгенерировать при первом запуске.
   *
   * Пароль печатается в консоль ровно один раз — в момент генерации. Печатать
   * его на каждом старте нельзя: логи контейнера видит всякий, у кого есть
   * доступ к панели CapRover, и пароль, повторяющийся в каждом запуске, живёт
   * в истории логов вечно.
   */
  private async generateIfMissing(): Promise<string | null> {
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
        '  Забыли пароль? Задайте свой в ADMIN_PASSWORD и перезапустите —',
        '  переменная главнее базы. Либо удалите документ из коллекции',
        '  admincredentials: тогда будет сгенерирован новый.',
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
