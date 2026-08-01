import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { AppConfigService } from '../../config/app-config.service';
import { AdminCredentialService } from '../../database/services/admin-credential.service';

import { LoginThrottle, minutesLeft } from './login-throttle';

/** Сколько живёт выданный токен. */
export const TOKEN_TTL = '7d';

export interface IAdminTokenPayload {
  /** Telegram id администратора. */
  sub: string;
}

@Injectable()
export class AdminAuthService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminAuthService.name);
  private readonly throttle = new LoginThrottle();

  constructor(
    private readonly credentials: AdminCredentialService,
    private readonly config: AppConfigService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Учётные данные при старте: пароль из `ADMIN_PASSWORD`, а если переменной
   * нет — сгенерированный при первом запуске.
   *
   * Сбой не роняет приложение: бот и отчёты от админ-панели не зависят, и
   * падение на недоступной Mongo здесь означало бы, что панель уронила бота.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.credentials.ensure(this.config.adminPassword);
    } catch (error) {
      this.logger.error('Не удалось создать учётные данные админ-панели', error as Error);
    }
  }

  /**
   * Вход. Возвращает подписанный токен.
   *
   * Порядок проверок значим: сначала блокировка, потом принадлежность к
   * администраторам, и только потом сверка пароля. Обратный порядок позволил бы
   * заблокированному перебирать пароли дальше.
   */
  async login(login: string, password: string): Promise<{ token: string }> {
    const now = Date.now();
    const locked = this.throttle.lockedFor(login, now);
    if (locked > 0) {
      throw new UnauthorizedException(
        `Слишком много неудачных попыток. Попробуйте через ${minutesLeft(locked)} мин.`,
      );
    }

    const credential = await this.credentials.find();
    if (!credential) {
      // Учётных данных ещё нет — значит первый старт не прошёл. Это не «неверный
      // пароль», и говорить надо ровно это, иначе админ будет искать опечатку.
      throw new ServiceUnavailableException(
        'Учётные данные ещё не созданы. Перезапустите приложение и посмотрите пароль в логах.',
      );
    }

    // Пароль сверяется ДАЖЕ для не-администратора: иначе время ответа выдавало
    // бы, какие id входят в TELEGRAM_ADMIN_IDS, — bcrypt заметно дороже проверки
    // членства в списке.
    const passwordOk = await bcrypt.compare(password, credential.passwordHash);
    const adminOk = this.config.isAdmin(login);

    if (!passwordOk || !adminOk) {
      this.throttle.registerFailure(login, now);
      this.logger.warn(`Неудачный вход в админ-панель: ${login}`);
      throw new UnauthorizedException('Неверный логин или пароль');
    }

    this.throttle.registerSuccess(login);
    this.logger.log(`Вход в админ-панель: ${login}`);

    const payload: IAdminTokenPayload = { sub: login };
    return {
      token: await this.jwt.signAsync(payload, {
        secret: credential.jwtSecret,
        expiresIn: TOKEN_TTL,
      }),
    };
  }

  /**
   * Проверка токена. Возвращает Telegram id или бросает.
   *
   * Принадлежность к администраторам сверяется ЗАНОВО, а не берётся на веру из
   * подписанного токена: отзыв админа в TELEGRAM_ADMIN_IDS обязан закрывать
   * панель сразу, а не через неделю, когда истечёт выданный токен.
   */
  async verify(token: string): Promise<string> {
    const credential = await this.credentials.find();
    if (!credential) throw new UnauthorizedException('Учётные данные не созданы');

    let payload: IAdminTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<IAdminTokenPayload>(token, {
        secret: credential.jwtSecret,
      });
    } catch {
      // Подделка, истечение и «секрет сменился» неотличимы для пользователя и
      // требуют одного действия — войти заново.
      throw new UnauthorizedException('Сессия истекла, войдите заново');
    }

    if (!this.config.isAdmin(payload.sub)) {
      throw new UnauthorizedException('Доступ отозван');
    }

    return payload.sub;
  }
}
