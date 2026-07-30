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

    return next.handle().pipe(
      tap(() => {
        const res = context.switchToHttp().getResponse();
        console.log(
          `Outgoing Response: ${req.method} ${req.url} - Status: ${res.statusCode} - ${Date.now() - now}ms`,
        );
      }),
    );
  }
}
