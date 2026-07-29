import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppConfigService } from './app-config.service';
import { envValidationSchema } from './env.validation';

/**
 * Единственная точка загрузки и валидации конфигурации.
 *
 * `isGlobal` + `@Global()` — чтобы AppConfigService можно было инжектить
 * где угодно без импорта модуля в каждый feature-модуль.
 *
 * `import 'dotenv/config'` больше нигде в коде быть не должно: раньше он стоял
 * в двух местах, и работоспособность зависела от того, какой из них исполнится
 * раньше при вычислении декораторов.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: envValidationSchema,
      validationOptions: {
        // Показать СРАЗУ все проблемы, а не по одной за запуск.
        abortEarly: false,
      },
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
