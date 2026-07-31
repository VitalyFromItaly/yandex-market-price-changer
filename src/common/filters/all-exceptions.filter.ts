import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';

import { Catch, HttpException, HttpStatus } from '@nestjs/common';

import { ErrorReporter } from '../../modules/errors/error-reporter.service';

/**
 * Глобальный фильтр HTTP-ошибок.
 *
 * До него ошибки контроллеров обрабатывал встроенный фильтр Nest: клиент ответ
 * получал, а следа «кто, когда, на каком запросе» не оставалось нигде —
 * LoggerInterceptor при падении молчит (`tap` с одним колбэком не срабатывает
 * на error), а записи в журнал не было вовсе.
 *
 * Ответ клиенту сохраняется прежним, и это не осторожность ради осторожности:
 * панель читает поле `message` у 401, и смена формата сломала бы вход, не
 * сломав ни одного теста.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly reporter: ErrorReporter) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    // 4xx — это поведение клиента, а не поломка: неверный пароль и опечатка в
    // дате не должны будить администратора алертом. В журнал пишутся обе
    // группы, различить их можно по httpStatus.
    const serverFault = status >= HttpStatus.INTERNAL_SERVER_ERROR;
    const target = `${request.method} ${request.url}`;

    void this.reporter.report({
      error: exception,
      source: 'http',
      // В контексте — шаблон маршрута, а не конкретный url: иначе каждый запрос
      // с новым id даёт новый ключ, и троттлинг алертов не срабатывает никогда.
      context: `http:${request.method} ${request.route?.path ?? request.url}`,
      action: target,
      httpStatus: status,
      requestUrl: target,
      alert: serverFault,
    });

    const body =
      exception instanceof HttpException
        ? exception.getResponse()
        : { statusCode: status, message: 'Внутренняя ошибка сервера' };

    response.status(status).json(body);
  }
}
