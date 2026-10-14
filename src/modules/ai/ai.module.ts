import { Module } from '@nestjs/common';

import { AppConfigService } from '../../config/app-config.service';
import { DatabaseModule } from '../../database/database.module';

import { AiService } from './ai.service';
import { PolzaClient } from './polza.client';

/**
 * ИИ через Polza.ai.
 *
 * PolzaClient — провайдер, но НЕ экспорт: наружу идёт только AiService, где
 * проверяются фича продавца, дневной лимит и учёт расхода.
 * Отдай модуль клиента наружу — и первый же новый хендлер позовёт его в обход
 * всех трёх.
 *
 * Без ключа модуль поднимается: клиент создаётся, а любой его вызов бросает
 * PolzaDisabledError до HTTP. ИИ — дополнение, а не условие работы бота.
 * AppConfigService и ErrorReporter приходят сами: их модули глобальные.
 * DatabaseModule — ради AiUsageService (учёт и дневной лимит).
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: PolzaClient,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        new PolzaClient({
          baseUrl: config.polzaAiBaseUrl,
          token: config.polzaAiToken,
          model: config.polzaAiModel,
        }),
    },
    AiService,
  ],
  exports: [AiService],
})
export class AiModule {}
