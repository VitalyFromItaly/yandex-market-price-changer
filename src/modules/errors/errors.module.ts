import { Global, Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';

import { ErrorReporter } from './error-reporter.service';

/**
 * Сбор ошибок.
 *
 * @Global намеренно: ErrorReporter нужен в хендлерах телеграма, в процессорах
 * очередей, в HTTP-фильтре и в main.ts. Импортировать его в каждый модуль —
 * ровно тот случай, ради которого глобальные модули и существуют, и ровно тот
 * случай, когда забытый импорт означает молча непойманную ошибку.
 *
 * Обратной зависимости нет: ErrorReporter знает только про журнал, а способ
 * отправки алертов ему подставляют снаружи (ErrorAlertBridge).
 */
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [ErrorReporter],
  exports: [ErrorReporter],
})
export class ErrorsModule {}
