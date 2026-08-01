import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Типизированный доступ к конфигурации.
 *
 * Нужен, чтобы по коду не расползались строковые ключи вида
 * `config.get('TELEGRAM_WEBHOOK_URL')` — опечатка в таком ключе не ловится
 * компилятором и превращается в `undefined` уже в рантайме. Здесь ключ
 * упоминается ровно один раз, а наружу торчит свойство с типом.
 *
 * Значения уже прошли Joi-валидацию (см. env.validation.ts), поэтому
 * обязательные поля гарантированно заданы и проверять их повторно не нужно.
 */
@Injectable()
export class AppConfigService {
  /** Разобранный TELEGRAM_ADMIN_IDS — см. геттер telegramAdminIds. */
  private adminIds?: number[];

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

  /**
   * Как забираем апдейты: Telegram стучится к нам (`webhook`) или мы сами
   * опрашиваем Bot API (`polling`).
   *
   * На российском хостинге вебхук недостижим для серверов Telegram — трафик
   * фильтруется в обе стороны, поэтому прод работает через polling, а тот
   * уходит на зеркало из telegramApiUrl.
   */
  get telegramUpdateMode(): 'webhook' | 'polling' {
    return this.config.get<'webhook' | 'polling'>('TELEGRAM_UPDATE_MODE');
  }

  /** Публичный HTTPS-домен, на который Telegram шлёт вебхуки НАМ. */
  get telegramWebhookUrl(): string {
    return this.config.get<string>('TELEGRAM_WEBHOOK_URL');
  }

  /**
   * Базовый URL Bot API, куда ходим МЫ: своё зеркало вместо api.telegram.org.
   *
   * Хвостовой слеш срезается здесь, а не в каждом потребителе: TelegramApiService
   * дописывает `/bot<token>/...` шаблоном, и `https://h/` дал бы `https://h//bot…`.
   */
  get telegramApiUrl(): string {
    return this.config.get<string>('TELEGRAM_API_URL').replace(/\/+$/, '');
  }

  /**
   * Telegram id администраторов, которым уходит карточка новой регистрации.
   *
   * Разбор кэшируется: геттер дёргается на КАЖДОМ апдейте телеграма (гейт
   * доступа спрашивает isAdmin первым делом), а split/map на каждое сообщение
   * — бессмысленная работа. Формат уже проверен Joi, поэтому здесь только
   * разбор, без валидации.
   */
  get telegramAdminIds(): number[] {
    this.adminIds ??= this.config
      .get<string>('TELEGRAM_ADMIN_IDS')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .map(Number);
    return this.adminIds;
  }

  /**
   * Единственный способ проверить админа. Метод есть, чтобы по хендлерам не
   * расползался `includes` — и, главное, чтобы никто не сравнил число
   * `ctx.from.id` со строкой из окружения (`'123' === 123` — false).
   *
   * Принимает и строку: id приходит числом из `ctx.from.id`, но строкой из
   * базы (`UserAccess.telegramUserId`). Приведение — здесь, в одном месте, а
   * не Number() по всем вызовам: как раз такие россыпи и рождают промах,
   * от которого метод защищает.
   */
  isAdmin(telegramUserId: number | string): boolean {
    return this.telegramAdminIds.includes(Number(telegramUserId));
  }

  /**
   * Пароль админ-панели, если задан явно.
   *
   * `undefined` означает «сгенерировать при первом запуске и показать в логах»
   * — прежнее поведение. Пустая строка приводится к `undefined` по той же
   * причине, что и у `redisPassword`: забытый `ADMIN_PASSWORD=` в .env иначе
   * стал бы паролем из нуля символов.
   *
   * Когда задан — он главнее хеша в базе; правило и его причина расписаны в
   * `AdminCredentialService.ensure`.
   */
  get adminPassword(): string | undefined {
    return this.config.get<string>('ADMIN_PASSWORD') || undefined;
  }

  get yandexMarketBaseUrl(): string {
    return this.config.get<string>('YANDEX_MARKET_BASE_URL');
  }
}
