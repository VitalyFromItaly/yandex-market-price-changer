import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { Injectable } from '@nestjs/common';

import { ActionLogService } from '../../database/services/action-log.service';
import { SYSTEM_USER } from '../errors/error-reporter.service';

import { crmLogEntry } from './crm-action-log.domain';
import { IRequestWithCrmUser } from './crm-jwt.guard';

/**
 * Каждый запрос к API CRM — строка в журнале админки.
 *
 * Middleware, а не интерцептор: интерцепторы Nest выполняются ПОСЛЕ гвардов,
 * и отказ гварда (истёкший токен, закрытая фича) до интерцептора не доходит —
 * а это самые интересные строки. Тот же довод, по которому `actionLog` бота
 * стоит перед `accessGate`. Пишется по `finish`: к этому моменту известны код
 * ответа, длительность и продавец, которого гвард положил в запрос.
 *
 * Запись не ждётся: `record` не бросает, а ответ уже ушёл.
 */
@Injectable()
export class CrmActionLogMiddleware implements NestMiddleware {
  constructor(private readonly logs: ActionLogService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = Date.now();

    response.on('finish', () => {
      const crm = request as Request & IRequestWithCrmUser;
      const user = crm.crmUser;
      void this.logs.record(
        crmLogEntry(
          {
            method: request.method,
            url: request.originalUrl,
            statusCode: response.statusCode,
            durationMs: Date.now() - startedAt,
            telegramUserId: user?.telegramUserId ?? crm.crmLoginId,
            username: user?.username,
            name: user?.name,
            error: response.locals.errorMessage as string | undefined,
          },
          SYSTEM_USER,
        ),
      );
    });

    next();
  }
}
