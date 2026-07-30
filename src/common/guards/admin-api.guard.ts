import type { CanActivate, ExecutionContext } from '@nestjs/common';

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

import { AppConfigService } from '../../config/app-config.service';

/** Заголовок, в котором админ называет свой Telegram id. */
export const ADMIN_ID_HEADER = 'x-telegram-user-id';

/**
 * Доступ к админскому API: секретный токен И id из TELEGRAM_ADMIN_IDS.
 *
 * Проверок две, и вторая не заменяет первую. Токен — это собственно защита;
 * заголовок с id подделывается тривиально и нужен для другого: чтобы список
 * тех, кто может читать журнал, задавался ОДНОЙ переменной вместе со списком
 * администраторов бота, а не разъезжался с ним. Отзыв админа в
 * TELEGRAM_ADMIN_IDS закрывает и API тоже.
 *
 * Без заданного ADMIN_API_TOKEN гвард не пускает НИКОГО. «Не настроено»
 * обязано означать «закрыто»: журнал содержит id и переписку пользователей,
 * и незаданная переменная не должна превращаться в открытый эндпоинт.
 */
@Injectable()
export class AdminApiGuard implements CanActivate {
  private readonly logger = new Logger(AdminApiGuard.name);

  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();

    const expected = this.config.adminApiToken;
    if (!expected) {
      this.logger.warn('Запрос к админскому API отклонён: ADMIN_API_TOKEN не задан');
      throw new UnauthorizedException('Админское API отключено: не задан ADMIN_API_TOKEN');
    }

    if (!this.tokenMatches(this.bearerOf(request.headers.authorization), expected)) {
      throw new UnauthorizedException('Неверный токен');
    }

    const id = this.headerOf(request.headers[ADMIN_ID_HEADER]);
    if (!id || !this.config.isAdmin(id)) {
      throw new UnauthorizedException(
        `Заголовок ${ADMIN_ID_HEADER} должен содержать Telegram id из TELEGRAM_ADMIN_IDS`,
      );
    }

    return true;
  }

  private headerOf(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }

  private bearerOf(value: string | string[] | undefined): string | undefined {
    const header = this.headerOf(value);
    if (!header) return undefined;
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match ? match[1] : undefined;
  }

  /**
   * Сравнение постоянного времени.
   *
   * Обычное `===` на строках выходит из цикла на первом несовпавшем байте, то
   * есть время ответа зависит от того, сколько символов токена угаданы верно.
   * Разница мизерная, но подбирать токен по одному символу она позволяет, а
   * стоит защита одну строку.
   */
  private tokenMatches(given: string | undefined, expected: string): boolean {
    if (!given) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    // timingSafeEqual требует одинаковой длины и бросает на разной — сама
    // длина при этом не секрет.
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
