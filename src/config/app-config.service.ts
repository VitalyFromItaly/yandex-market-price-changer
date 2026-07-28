import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Типизированный доступ к конфигурации.
 *
 * Нужен, чтобы по коду не расползались строковые ключи вида
 * `config.get('TELEGRAM_PROXY_URL')` — опечатка в таком ключе не ловится
 * компилятором и превращается в `undefined` уже в рантайме. Здесь ключ
 * упоминается ровно один раз, а наружу торчит свойство с типом.
 *
 * Значения уже прошли Joi-валидацию (см. env.validation.ts), поэтому
 * обязательные поля гарантированно заданы и проверять их повторно не нужно.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService) {}

  get nodeEnv(): string {
    return this.config.get<string>('NODE_ENV');
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get port(): number {
    return this.config.get<number>('PORT');
  }

  get mongoUrl(): string {
    return this.config.get<string>('MONGODB_URL');
  }

  get mongoDatabase(): string {
    return this.config.get<string>('MONGODB_DATABASE');
  }

  get redisHost(): string {
    return this.config.get<string>('REDIS_HOST');
  }

  get redisPort(): number {
    return this.config.get<number>('REDIS_PORT');
  }

  /**
   * Пустая строка означает «пароля нет» и должна превращаться в undefined:
   * если передать Redis без auth пустой пароль, сервер пишет предупреждение
   * на каждое соединение.
   */
  get redisPassword(): string | undefined {
    return this.config.get<string>('REDIS_PASSWORD') || undefined;
  }

  get telegramToken(): string {
    return this.config.get<string>('TELEGRAM_TOKEN');
  }

  /** Публичный HTTPS-домен, на который Telegram шлёт вебхуки. */
  get telegramProxyUrl(): string {
    return this.config.get<string>('TELEGRAM_PROXY_URL');
  }

  get yandexMarketBaseUrl(): string {
    return this.config.get<string>('YANDEX_MARKET_BASE_URL');
  }
}
