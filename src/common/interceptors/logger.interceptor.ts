// src/common/interceptors/logging.interceptor.ts
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggerInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const now = Date.now();

    console.log(`Incoming Request: ${req.method} ${req.url}`);

    // tap с ОДНИМ колбэком — это только ветка next: упавший запрос не давал
    // ни строки «Outgoing Response», ни следа об ошибке. Записывает её
    // AllExceptionsFilter, а здесь важно, чтобы в консоли не оставалось
    // запроса, у которого есть начало и нет конца.
    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse();
          console.log(
            `Outgoing Response: ${req.method} ${req.url} - Status: ${res.statusCode} - ${Date.now() - now}ms`,
          );
        },
        error: (error: Error) => {
          console.log(
            `Failed Response: ${req.method} ${req.url} - ${error.name}: ${error.message} - ${Date.now() - now}ms`,
          );
        },
      }),
    );
  }
}
