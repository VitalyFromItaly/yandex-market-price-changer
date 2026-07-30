import type { CanActivate, ExecutionContext } from '@nestjs/common';

import { Injectable, UnauthorizedException } from '@nestjs/common';

import { AdminAuthService } from './admin-auth.service';

/** Что гвард кладёт в запрос для контроллеров. */
export interface IRequestWithAdmin {
  headers: Record<string, string | string[] | undefined>;
  adminId?: string;
}

/**
 * Доступ к админскому API по токену, выданному /api/auth/login.
 *
 * Пришёл на смену AdminApiGuard со статичным ADMIN_API_TOKEN: тот жил в
 * переменной окружения, был один на всех и на все времена, и вводить его
 * в панель означало держать вечный секрет в браузере.
 */
@Injectable()
export class AdminJwtGuard implements CanActivate {
  constructor(private readonly auth: AdminAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IRequestWithAdmin>();
    const token = this.bearerOf(request.headers.authorization);

    if (!token) throw new UnauthorizedException('Нужен заголовок Authorization: Bearer <токен>');

    // Кто именно вошёл — контроллерам может пригодиться, а лезть в токен
    // второй раз им незачем.
    request.adminId = await this.auth.verify(token);
    return true;
  }

  private bearerOf(value: string | string[] | undefined): string | undefined {
    const header = Array.isArray(value) ? value[0] : value;
    if (!header) return undefined;
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match ? match[1] : undefined;
  }
}
