import type { CallHandler, ExecutionContext, NestInterceptor, Type } from '@nestjs/common';
import type { Observable } from 'rxjs';

import { Injectable, PayloadTooLargeException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { FILE_TOO_LARGE } from './price-list/crm-price-list.domain';

/**
 * Multipart с одним файлом в поле `file`: multer в памяти (memoryStorage по
 * умолчанию) с лимитом размера. Multer обрывает поток на превышении, так что
 * файл больше лимита целиком в память не ложится.
 *
 * Обёртка, а не голый `FileInterceptor`: его 413 несёт английское «File too
 * large» без `code`, а фронту нужен код, чтобы поставить ошибку под поле, и
 * русский текст. Фабрика — потому что загрузок две (прайс, финотчёт TASK-114)
 * с разными лимитами и текстами, а правило перевода 413 одно.
 */
export function createUploadInterceptor(options: {
  maxBytes: number;
  /** Текст 413 для продавца. */
  tooLargeMessage: string;
}): Type<NestInterceptor> {
  const Multer = FileInterceptor('file', {
    limits: { fileSize: options.maxBytes, files: 1, fields: 5 },
  });

  @Injectable()
  class UploadInterceptor implements NestInterceptor {
    private readonly inner = new Multer();

    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
      try {
        return await this.inner.intercept(context, next);
      } catch (error) {
        if (error instanceof PayloadTooLargeException) {
          throw new PayloadTooLargeException({
            statusCode: 413,
            code: FILE_TOO_LARGE,
            field: 'file',
            message: options.tooLargeMessage,
          });
        }
        throw error;
      }
    }
  }
  return UploadInterceptor;
}
