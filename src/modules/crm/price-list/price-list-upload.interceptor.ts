import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';

import { Injectable, PayloadTooLargeException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { UPLOAD_LIMITS } from '../../yandex/stocks/stock-upload-policy';
import { uploadFileErrorText } from '../../yandex/stocks/stock-upload.texts';

import { FILE_TOO_LARGE } from './crm-price-list.domain';

/**
 * Multipart с прайсом: multer в памяти (memoryStorage по умолчанию), лимит —
 * тот же `UPLOAD_LIMITS.maxBytes`, что у бота. Multer обрывает поток на
 * превышении, так что 11-мегабайтный файл целиком в память не ложится.
 *
 * Обёртка, а не голый `FileInterceptor`: его 413 несёт английское «File too
 * large» без `code`, а фронту нужен код, чтобы поставить ошибку под поле, и
 * русский текст — тот же, что бот отвечает на слишком большой файл.
 */
const Multer = FileInterceptor('file', {
  limits: { fileSize: UPLOAD_LIMITS.maxBytes, files: 1, fields: 5 },
});

@Injectable()
export class PriceListUploadInterceptor implements NestInterceptor {
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
          message: uploadFileErrorText('size', ''),
        });
      }
      throw error;
    }
  }
}
