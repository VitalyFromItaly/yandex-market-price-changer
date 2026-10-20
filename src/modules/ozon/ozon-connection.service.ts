import type { IOzonCredentials } from './ozon.client';
import type { IMarketplaceConnectionRow } from '../../database/services/marketplace-connection.service';

import { Injectable, Logger } from '@nestjs/common';

import { MarketplaceConnectionService } from '../../database/services/marketplace-connection.service';
import { ErrorReporter } from '../errors/error-reporter.service';

import { OzonClientFactory } from './ozon-client.factory';
import { OzonAuthError } from './ozon.errors';

/** Кто спрашивает — для журнала ошибок. Ключ сюда не попадает никогда. */
export interface IOzonCallOrigin {
  telegramUserId: string;
  source: 'crm';
  context: string;
}

/**
 * Итог проверки ключа. Отказ, недоступность и «ключ без ролей» — РАЗНЫЕ
 * исходы: свернуть их в один значит сказать продавцу с опечаткой в ключе
 * «попробуйте позже» (урок TASK-077, `StoresService.listByToken`).
 */
export type TOzonVerifyResult =
  | { ok: true; roles: string[]; expiresAt: string | null }
  | { ok: false; reason: 'auth'; message: string }
  | { ok: false; reason: 'empty' | 'unavailable' };

export type TOzonConnectResult =
  | { ok: true; connection: IMarketplaceConnectionRow }
  | Exclude<TOzonVerifyResult, { ok: true }>;

/**
 * Подключение Ozon: проверка ключа у Ozon и запись — только после успешной
 * проверки. Неверный ключ ничего не пишет, поэтому рабочий не перетирается
 * (правило `MarketplaceConnectionService.save`).
 */
@Injectable()
export class OzonConnectionService {
  private readonly logger = new Logger(OzonConnectionService.name);

  constructor(
    private readonly clients: OzonClientFactory,
    private readonly connections: MarketplaceConnectionService,
    private readonly errors: ErrorReporter,
  ) {}

  /** Один запрос ролей ключа (`POST /v1/roles`); никогда не бросает. */
  async verify(credentials: IOzonCredentials, origin: IOzonCallOrigin): Promise<TOzonVerifyResult> {
    try {
      const { roles, expiresAt } = await this.clients.forCredentials(credentials).roles();
      // Ключ, у которого нет ни одной роли, Ozon принимает, но читать им нечего.
      if (roles.length === 0) return { ok: false, reason: 'empty' };
      return { ok: true, roles: roles.map((role) => role.name), expiresAt };
    } catch (error) {
      const auth = error instanceof OzonAuthError;
      // Ключ НЕ логируем — только класс ошибки.
      this.logger.warn(
        `Ozon не подтвердил ключ пользователя ${origin.telegramUserId}: ${
          error instanceof Error ? error.constructor.name : 'неизвестная ошибка'
        }`,
      );
      void this.errors.report({
        error,
        source: origin.source,
        context: origin.context,
        telegramUserId: origin.telegramUserId,
        action: 'проверка ключа Ozon',
        // Опечатка продавца в ключе — не авария: в журнал, но без алерта.
        alert: !auth,
      });
      if (auth) return { ok: false, reason: 'auth', message: error.userMessage };
      return { ok: false, reason: 'unavailable' };
    }
  }

  async connect(
    telegramUserId: string,
    credentials: IOzonCredentials,
    origin: IOzonCallOrigin,
  ): Promise<TOzonConnectResult> {
    const check = await this.verify(credentials, origin);
    if (check.ok === false) return check;

    const connection = await this.connections.save(telegramUserId, 'ozon', {
      credentials: { clientId: credentials.clientId, apiKey: credentials.apiKey },
      status: 'ok',
      // Один ключ — один кабинет Ozon; его номер и есть Client-Id. Название
      // кабинета /v1/roles не отдаёт, а выдумывать его нельзя.
      accounts: [{ id: credentials.clientId, name: '' }],
    });
    return { ok: true, connection };
  }
}
