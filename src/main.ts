import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { LoggerInterceptor } from './common/interceptors/logger.interceptor';
import { AppConfigService } from './config/app-config.service';

async function bootstrap() {
  // `import 'dotenv/config'` здесь больше не нужен: загрузку и валидацию
  // окружения выполняет ConfigModule внутри AppModule. При отсутствии
  // обязательной переменной приложение упадёт здесь же, на create(), с
  // перечислением сразу всех недостающих ключей.
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('/api');
  app.useGlobalInterceptors(new LoggerInterceptor());

  const config = app.get(AppConfigService);
  await app.listen(config.port);
}

bootstrap();
