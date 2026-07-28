import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import 'dotenv/config';
import { LoggerInterceptor } from './common/interceptors/logger.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('/api');
  app.useGlobalInterceptors(new LoggerInterceptor());
  await app.listen(process.env.PORT || 3000);
}
bootstrap();
