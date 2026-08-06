import type { ICheckResult, TCheckKey, TCheckState } from './health.domain';

import { InjectQueue } from '@nestjs/bull';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  forwardRef,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Queue } from 'bull';
import { Connection } from 'mongoose';
import { statfs } from 'node:fs/promises';

import { AppConfigService } from '../../config/app-config.service';
import { ActionLogService } from '../../database/services/action-log.service';
import { ErrorReporter, SYSTEM_USER } from '../errors/error-reporter.service';
import { QUEUE_NAMES } from '../telegram';
import { BotRegistry } from '../telegram/bots/bot-registry.service';
import { moscowClock, moscowDateParam, moscowStamp } from '../yandex/reports/moscow-day';

import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  HealthCheckError,
  LOG_OK_INTERVAL_MS,
  PING_TIMEOUT_MS,
  checkTitle,
  diskDetail,
  diskStateOf,
  problemText,
  recoveryText,
  shouldNotify,
  shouldSendDailySummary,
  summaryText,
} from './health.domain';

/** Раздел, который меряем: rootfs контейнера лежит там же, где /var/lib/docker. */
const DISK_PATH = '/';

interface ICheckMemory {
  state: TCheckState;
  notifiedAt: number | null;
  /** Когда последний раз печатали «в порядке»: норма шумит раз в час, не чаще. */
  loggedOkAt: number | null;
}

/**
 * Самопроверка окружения: место на диске, MongoDB, Redis, Telegram Bot API и
 * API Яндекс.Маркета.
 *
 * Зачем. Раньше об аварии узнавали только от продавца: алерты уходили из
 * telegraf.catch, то есть лишь когда живой человек нажал кнопку и получил
 * ошибку. Ночью падение базы оставалось незамеченным до утра. 05-08-2026 так и
 * вышло — кончилось место на хосте, Mongo ушла в crash-loop, деплой перестал
 * собираться, и первым об этом сообщил пользователь.
 *
 * Место на диске здесь — главная метрика: оно кончается постепенно, и
 * предупреждение приходит ЗАДОЛГО до того, как упадёт база и перестанет
 * собираться образ.
 *
 * Почему setInterval, а не repeatable-задача Bull, которой в проекте разосланы
 * ежедневные сводки: repeatable живёт в Redis. При падении Redis она просто не
 * выполнится, то есть именно эта авария не была бы обнаружена никогда. Монитор
 * обязан работать тогда, когда сломано всё остальное, и поэтому не зависит ни
 * от Mongo, ни от Redis.
 *
 * Сообщение уходит СРАЗУ при обнаружении проблемы и больше не повторяется, пока
 * состояние не изменилось (см. shouldNotify). Раз в час, пока проблема держится,
 * приходит напоминание — иначе молчание неотличимо от «починилось».
 */
@Injectable()
export class HealthMonitorService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(HealthMonitorService.name);
  private timer?: NodeJS.Timeout;
  /** Предыдущее состояние каждой проверки: алерт шлётся по СМЕНЕ, а не по факту. */
  private readonly memory = new Map<TCheckKey, ICheckMemory>();
  /** Московский день последней сводки. null — сводки ещё не было ни одной. */
  private lastSummaryDay: string | null = null;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectQueue(QUEUE_NAMES.REPORTS) private readonly reports: Queue,
    private readonly errors: ErrorReporter,
    private readonly logs: ActionLogService,
    private readonly config: AppConfigService,
    // forwardRef и на провайдере, не только на импорте модуля: при обоюдном
    // цикле (TelegramModule ↔ HealthModule) Nest иначе подставляет undefined и
    // падает с UndefinedDependencyException.
    @Inject(forwardRef(() => BotRegistry))
    private readonly registry: BotRegistry,
  ) {}

  onApplicationBootstrap(): void {
    // Первый запуск с задержкой: соединения поднимаются не мгновенно, и без неё
    // монитор рапортовал бы об аварии при каждом старте.
    this.timer = setTimeout(() => {
      void this.run();
      this.timer = setInterval(() => void this.run(), CHECK_INTERVAL_MS);
    }, FIRST_CHECK_DELAY_MS);

    this.logger.log(`Самопроверка каждые ${Math.round(CHECK_INTERVAL_MS / 60000)} мин`);
  }

  /**
   * Без остановки таймер держит event loop, и контейнер, получивший SIGTERM,
   * не завершается — тот же довод, что у BotRegistry.onApplicationShutdown.
   * clearInterval работает и для setTimeout: это один и тот же дескриптор.
   */
  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * Снять состояние, ничего не отправляя. Отсюда же берёт данные команда
   * /health: показывать администратору нужно ровно то, по чему монитор принимает
   * решения, а не отдельно посчитанное второе мнение.
   */
  public async collect(): Promise<ICheckResult[]> {
    // Параллельно: две внешние проверки ходят по сети, и последовательный обход
    // растянул бы проход на сумму таймаутов вместо самого долгого из них.
    return await Promise.all([
      this.checkDisk(),
      Promise.resolve(this.checkMongo()),
      this.checkRedis(),
      this.checkTelegram(),
      this.checkYandex(),
    ]);
  }

  /** Один проход. Публичный — им же пользуется тест и ручная проверка. */
  public async run(): Promise<void> {
    const results = await this.collect();

    const now = Date.now();
    for (const result of results) {
      this.handle(result, now);
    }

    this.reportPeriodically(results, new Date());
  }

  /**
   * Сообщение при старте и ежедневная сводка.
   *
   * Обе существуют ради одного: пока приходят только аварии, «всё тихо» и
   * «уведомления сломаны» выглядят одинаково, и разница вскроется ровно тогда,
   * когда сообщение не придёт. Раз сводка приходит каждый день, её отсутствие —
   * само по себе сигнал.
   *
   * Стартовое сообщение заодно засчитывается за сегодняшнюю сводку: иначе
   * поднятый днём контейнер прислал бы два одинаковых письма подряд. Побочно оно
   * же показывает незапланированные рестарты контейнера.
   */
  private reportPeriodically(results: ICheckResult[], now: Date): void {
    const day = moscowDateParam(now);
    const stamp = moscowStamp(now);

    if (this.lastSummaryDay === null) {
      this.lastSummaryDay = day;
      this.errors.notifyAdmins(summaryText('🚀 Бот запущен', results, stamp));
      return;
    }

    if (shouldSendDailySummary(this.lastSummaryDay, day, moscowClock(now))) {
      this.lastSummaryDay = day;
      this.errors.notifyAdmins(summaryText('📊 Сводка за сутки', results, stamp));
    }
  }

  private handle(result: ICheckResult, now: number): void {
    const previous = this.memory.get(result.key) ?? {
      state: 'ok',
      notifiedAt: null,
      loggedOkAt: null,
    };
    const next: ICheckMemory = { ...previous, state: result.state };
    const line = `${checkTitle(result.key)}: ${result.state} · ${result.detail}`;

    if (result.state === 'ok') {
      // Норма — не чаще раза в час, иначе за сутки набегает под тысячу строк и
      // в docker logs аварию приходится искать. Проблема печатается всегда.
      const stale = previous.loggedOkAt === null || now - previous.loggedOkAt >= LOG_OK_INTERVAL_MS;
      if (stale || previous.state !== 'ok') {
        this.logger.log(line);
        next.loggedOkAt = now;
      }
    } else {
      this.logger.warn(line);
    }

    if (!shouldNotify(previous.state, result.state, previous.notifiedAt, now)) {
      this.memory.set(result.key, next);
      return;
    }

    if (result.state === 'ok') {
      this.errors.notifyAdmins(recoveryText(result));
      // Через record, а не через report: восстановление ошибкой не является и в
      // счётчике ошибок панели ему не место. Зато рядом с записью об аварии по
      // тому же context видно, когда и чем всё кончилось.
      void this.logs.record({
        telegramUserId: SYSTEM_USER,
        botId: SYSTEM_USER,
        kind: 'health',
        // Однострочный вид, тот же что в консоли: поле error оставляем пустым —
        // класть в него «снова в норме» значило бы врать фильтру «покажи
        // только сломавшееся».
        action: line,
        status: 'ok',
        source: 'process',
        context: `health:${result.key}`,
      });
    } else {
      // alert: false — отправкой управляет shouldNotify, а не 15-минутное окно
      // AlertThrottle: оно проглотило бы переход «мало места» → «места нет».
      // Запись в журнал при этом остаётся, и авария видна в админ-панели.
      void this.errors.report({
        error: new HealthCheckError(problemText(result)),
        source: 'process',
        context: `health:${result.key}`,
        action: 'health-check',
        alert: false,
      });
      this.errors.notifyAdmins(problemText(result));
    }

    next.notifiedAt = now;
    this.memory.set(result.key, next);
  }

  private async checkDisk(): Promise<ICheckResult> {
    try {
      const stats = await statfs(DISK_PATH);
      // bavail, а не bfree: часть блоков зарезервирована под root, и обычный
      // процесс их не получит — писать он перестанет раньше, чем bfree дойдёт
      // до нуля.
      //
      // Знаменатель — весь раздел, тогда как df делит на «занято + доступно».
      // Поэтому наша доля на пару пунктов строже той, что печатает df: порог
      // срабатывает чуть раньше, а это верная сторона для тревоги.
      const available = Number(stats.bavail) * Number(stats.bsize);
      const total = Number(stats.blocks) * Number(stats.bsize);

      return {
        key: 'disk',
        state: diskStateOf(available, total),
        detail: diskDetail(available, total),
      };
    } catch (error) {
      return { key: 'disk', state: 'down', detail: this.messageOf(error) };
    }
  }

  /**
   * readyState, а не ping: serverSelectionTimeoutMS равен 30 секундам, и пинг
   * подвешивал бы каждую проверку на полминуты ровно во время аварии — то есть
   * тогда, когда монитор нужен. Потерянное соединение mongoose отражает здесь
   * сразу.
   */
  private checkMongo(): ICheckResult {
    const ready = this.connection.readyState === 1;
    return {
      key: 'mongo',
      state: ready ? 'ok' : 'down',
      detail: ready ? 'соединение установлено' : `readyState=${this.connection.readyState}`,
    };
  }

  private async checkRedis(): Promise<ICheckResult> {
    try {
      // client Bull — это ioredis; у него свои ретраи, поэтому пинг без гонки
      // может не вернуться вовсе и подвесить весь цикл проверки.
      await this.withTimeout(this.reports.client.ping(), PING_TIMEOUT_MS);
      return { key: 'redis', state: 'ok', detail: 'отвечает на ping' };
    } catch (error) {
      return { key: 'redis', state: 'down', detail: this.messageOf(error) };
    }
  }

  /**
   * Telegram Bot API — через getMe уже зарегистрированного бота, а не своим
   * запросом: так проверяется ровно тот путь, которым ходят все ответы
   * продавцам, вместе с зеркалом из TELEGRAM_API_URL. Прод стоит в РФ, где
   * api.telegram.org недоступен напрямую, и отказ зеркала — это ровно тот класс
   * аварии, ради которого монитор написан.
   *
   * getMe не входит в OUTGOING_METHODS, поэтому журнал исходящих не засоряет.
   *
   * Неверный токен даёт 401 и тоже считается аварией: причина другая, а
   * последствие одно — бот молчит.
   *
   * Замкнутый круг признаётся честно: если недоступен именно Telegram, алерт об
   * этом отправить нечем. Останутся строка в консоли и запись в журнале, а когда
   * связь вернётся — придёт «снова в норме».
   */
  private async checkTelegram(): Promise<ICheckResult> {
    const bot = this.registry.first();
    if (!bot) {
      return { key: 'telegram', state: 'down', detail: 'ни один бот не зарегистрирован' };
    }

    try {
      const me = await this.withTimeout(bot.telegraf.telegram.getMe(), PING_TIMEOUT_MS);
      return { key: 'telegram', state: 'ok', detail: `@${me.username} отвечает` };
    } catch (error) {
      return { key: 'telegram', state: 'down', detail: this.messageOf(error) };
    }
  }

  /**
   * API Яндекс.Маркета — запрос БЕЗ ключа, и ответ 401/403 считается успехом.
   *
   * Проверяется достижимость сервиса, а не право доступа: ключи в Partner API
   * персональные, и взять чужой токен продавца, чтобы каждые пять минут жечь его
   * квоту ради самопроверки, нельзя. Любой HTTP-ответ доказывает, что сеть, DNS
   * и сам сервис живы; сетевая ошибка или таймаут — что нет.
   *
   * Единственный в src ручной адрес Яндекса, и это осознанно: PriceChanger
   * строится вокруг ключа конкретного продавца, а здесь ключа нет по замыслу.
   */
  private async checkYandex(): Promise<ICheckResult> {
    const url = `${this.config.yandexMarketBaseUrl}/v2/campaigns`;

    try {
      const response = await this.withTimeout(
        fetch(url, { method: 'GET', signal: AbortSignal.timeout(PING_TIMEOUT_MS) }),
        PING_TIMEOUT_MS,
      );
      return { key: 'yandex', state: 'ok', detail: `отвечает (HTTP ${response.status})` };
    } catch (error) {
      return { key: 'yandex', state: 'down', detail: this.messageOf(error) };
    }
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const guard = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new HealthCheckError(`нет ответа за ${ms} мс`)), ms);
    });

    try {
      return await Promise.race([promise, guard]);
    } finally {
      // Без очистки таймер держит event loop до срабатывания, и штатное
      // завершение процесса ждёт лишние секунды на каждой удачной проверке.
      if (timer) clearTimeout(timer);
    }
  }

  private messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
