import type { CanActivate, ExecutionContext } from '@nestjs/common';

import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ALLOW_PENDING_PASSWORD_CHANGE, REQUIRE_FEATURE } from './crm-auth.decorators';
import { PASSWORD_CHANGE_REQUIRED } from './crm-auth.domain';
import { CrmAuthService, ICrmUser } from './crm-auth.service';
import { featureBlock, needsPlacement } from './crm-features.domain';

/** Что гвард кладёт в запрос для контроллеров CRM. */
export interface IRequestWithCrmUser {
  headers: Record<string, string | string[] | undefined>;
  crmUser?: ICrmUser;
  /** id вошедшего на `/auth/login` — для журнала, пока токена ещё нет. */
  crmLoginId?: string;
}

/**
 * Доступ к API CRM по токену из /api/crm/auth/login.
 *
 * Токен проверяется целиком на КАЖДОМ запросе (`CrmAuthService.verify`):
 * подпись, аудитория, версия пароля и статус доступа в боте. Отзыв доступа в
 * боте или панели обязан закрывать CRM сразу, а не через неделю жизни токена.
 */
@Injectable()
export class CrmJwtGuard implements CanActivate {
  constructor(
    private readonly auth: CrmAuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IRequestWithCrmUser>();
    const token = this.bearerOf(request.headers.authorization);

    if (!token) throw new UnauthorizedException('Нужен заголовок Authorization: Bearer <токен>');

    const user = await this.auth.verify(token);

    // В запрос — ДО проверок ниже: отказ по паролю или фиче журнал обязан
    // приписать продавцу, а не `system` (CrmActionLogMiddleware читает отсюда).
    request.crmUser = user;

    if (user.mustChangePassword) {
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD_CHANGE, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowed) {
        throw new ForbiddenException({
          statusCode: 403,
          code: PASSWORD_CHANGE_REQUIRED,
          message: 'Сначала смените стартовый пароль',
        });
      }
    }

    await this.checkFeatures(context, user);
    return true;
  }

  /**
   * Гейт фич: `@RequireFeature` на маршруте или контроллере. Правило общее с
   * ботом (`isFeatureOpen`); модель магазина читается, только если среди ключей
   * есть FBY-only, — остальным маршрутам лишнее чтение ни к чему.
   */
  private async checkFeatures(context: ExecutionContext, user: ICrmUser): Promise<void> {
    const keys = this.reflector.getAllAndOverride<string[] | undefined>(REQUIRE_FEATURE, [
      context.getHandler(),
      context.getClass(),
    ]);
    await this.assertFeatures(user, keys);
  }

  /**
   * То же правило для ключей, известных только во время запроса — фоновая
   * задача CRM объявляет свои фичи в реестре kind-ов, а не декоратором.
   * Одна проверка на оба пути, второй копии `featureBlock` нет.
   *
   * `store` — магазин, открытый в вебе: FBY-only фича решается по ЕГО модели,
   * а не по активному магазину бота. Без него — активный (маршруты аккаунта).
   */
  async assertFeatures(
    user: ICrmUser,
    keys: readonly string[] | undefined,
    store?: { placementType?: string },
  ): Promise<void> {
    if (!keys?.length) return;

    let placement: string | undefined;
    if (needsPlacement(keys)) {
      placement = store ? store.placementType : await this.auth.placementOf(user.telegramUserId);
    }
    const block = featureBlock(user.features, keys, placement);
    if (block) throw new ForbiddenException({ statusCode: 403, ...block });
  }

  private bearerOf(value: string | string[] | undefined): string | undefined {
    const header = Array.isArray(value) ? value[0] : value;
    if (!header) return undefined;
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match ? match[1] : undefined;
  }
}
