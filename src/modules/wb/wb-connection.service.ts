import type { TWbCategory } from './wb.client';
import type { IMarketplaceConnectionRow } from '../../database/services/marketplace-connection.service';

import { Injectable, Logger } from '@nestjs/common';

import { MarketplaceConnectionService } from '../../database/services/marketplace-connection.service';
import { ErrorReporter } from '../errors/error-reporter.service';

import { WbClientFactory } from './wb-client.factory';
import { WB_REQUIRED_CATEGORIES, missingCategoriesText } from './wb-connection.domain';
import { WbAuthError } from './wb.errors';

/** Кто спрашивает — для журнала ошибок. Токен сюда не попадает никогда. */
export interface IWbCallOrigin {
  telegramUserId: string;
  source: 'crm';
  context: string;
}

/**
 * Итог проверки токена. Отказ, нехватка категорий и недоступность WB — РАЗНЫЕ
 * исходы (урок TASK-077): продавцу с токеном без «Финансов» нужно перевыпустить
 * токен с галочкой, а не «попробовать позже».
 */
export type TWbVerifyResult =
  | { ok: true; seller: { sid: string; name: string } }
  | { ok: false; reason: 'auth'; message: string }
  | { ok: false; reason: 'scopes'; missing: TWbCategory[]; message: string }
  | { ok: false; reason: 'unavailable' };

export type TWbConnectResult =
  | { ok: true; connection: IMarketplaceConnectionRow }
  | Exclude<TWbVerifyResult, { ok: true }>;

/**
 * Подключение WB: проверка токена у WB и запись — только после успешной
 * проверки. Неверный токен ничего не пишет, рабочий не перетирается (правило
 * `MarketplaceConnectionService.save`, как у Ozon).
 *
 * Проверка — `GET /ping` на хосте каждой нужной категории, по очереди: у WB
 * один токен открывает только выбранные при выпуске категории, и единственный
 * способ узнать, какие, — спросить хост категории. Отказ на всех — токен не
 * работает; на части — не хватает категорий, с перечнем. Любой другой сбой
 * (сеть, 5xx, 429) — «WB недоступен»: о токене он ничего не говорит.
 */
@Injectable()
export class WbConnectionService {
  private readonly logger = new Logger(WbConnectionService.name);

  constructor(
    private readonly clients: WbClientFactory,
    private readonly connections: MarketplaceConnectionService,
    private readonly errors: ErrorReporter,
  ) {}

  /** Никогда не бросает. */
  async verify(token: string, origin: IWbCallOrigin): Promise<TWbVerifyResult> {
    const client = this.clients.forToken(token);
    const missing: TWbCategory[] = [];
    let authError: WbAuthError | null = null;

    for (const category of WB_REQUIRED_CATEGORIES) {
      try {
        await client.ping(category);
      } catch (error) {
        if (error instanceof WbAuthError) {
          missing.push(category);
          authError = error;
          continue;
        }
        this.report(error, origin, true);
        return { ok: false, reason: 'unavailable' };
      }
    }

    if (authError !== null) {
      // Опечатка или токен без галочки — не авария: в журнал, без алерта.
      this.report(authError, origin, false);
      if (missing.length === WB_REQUIRED_CATEGORIES.length) {
        return { ok: false, reason: 'auth', message: authError.userMessage };
      }
      return { ok: false, reason: 'scopes', missing, message: missingCategoriesText(missing) };
    }

    // Название кабинета — украшение: его отсутствие подключение не отменяет.
    try {
      const info = await client.sellerInfo();
      return { ok: true, seller: { sid: info.sid, name: info.name || info.tradeMark } };
    } catch (error) {
      this.report(error, origin, false);
      return { ok: true, seller: { sid: '', name: '' } };
    }
  }

  async connect(
    telegramUserId: string,
    token: string,
    origin: IWbCallOrigin,
  ): Promise<TWbConnectResult> {
    const check = await this.verify(token, origin);
    if (check.ok === false) return check;

    const connection = await this.connections.save(telegramUserId, 'wb', {
      credentials: { token },
      status: 'ok',
      accounts: [{ id: check.seller.sid, name: check.seller.name }],
    });
    return { ok: true, connection };
  }

  private report(error: unknown, origin: IWbCallOrigin, alert: boolean): void {
    // Токен НЕ логируем — только класс ошибки.
    this.logger.warn(
      `WB не подтвердил токен пользователя ${origin.telegramUserId}: ${
        error instanceof Error ? error.constructor.name : 'неизвестная ошибка'
      }`,
    );
    void this.errors.report({
      error,
      source: origin.source,
      context: origin.context,
      telegramUserId: origin.telegramUserId,
      action: 'проверка токена Wildberries',
      alert,
    });
  }
}
