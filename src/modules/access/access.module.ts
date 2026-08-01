import { Module, forwardRef } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AdminAuthModule } from '../admin/admin-auth.module';
import { TelegramModule } from '../telegram/telegram.module';

import { AccessNotifierService } from './access-notifier.service';
import { AccessController } from './access.controller';

/**
 * Админское управление пофичным доступом.
 *
 * Отдельный модуль по той же причине, что и LogsModule: TelegramModule собирает
 * ботов и очереди, и HTTP-эндпоинт с собственной авторизацией внутри него
 * смешал бы две несвязанные ответственности. Читать и править флаги будет этот
 * модуль, применять их — telegram; общий у них только сервис из DatabaseModule.
 *
 * Гвард приходит из AdminAuthModule вместе с сервисом, который он зовёт.
 *
 * TelegramModule нужен ради одного: открыв или закрыв доступ, панель обязана
 * сказать об этом продавцу — молчаливое отключение он воспримет как поломку
 * бота. `forwardRef` здесь не для цикла (его нет), а на будущее: TelegramModule
 * тяжёлый и вполне может однажды понадобиться сам знать про пофичный доступ.
 */
@Module({
  imports: [DatabaseModule, AdminAuthModule, forwardRef(() => TelegramModule)],
  controllers: [AccessController],
  providers: [AccessNotifierService],
})
export class AccessModule {}
