import { Injectable, Logger } from '@nestjs/common';
import { DrizzleQueryError } from 'drizzle-orm';

import { ActionLogService } from '../../database/services/action-log.service';
import { PolzaApiError } from '../ai/polza.errors';
import { telegramErrorInfo } from '../metrics/metrics.domain';
import { OzonApiError } from '../ozon/ozon.errors';
import { maskOutgoing, truncate } from '../telegram/bots/shared/action-log.domain';
import { esc } from '../telegram/formatting/telegram-format';
import { WbApiError } from '../wb/wb.errors';
import { ReportGenerationError } from '../yandex/report-generation.error';
import { YandexApiError } from '../yandex/yandex-api.errors';

import { AlertThrottle } from './alert-throttle';

/**
 * Откуда прилетела ошибка. `scanner` — внешний сканер секретов (404 на
 * несматченный маршрут); такие записи прячутся из основного журнала и живут во
 * вкладке «Мусор» (см. JUNK_SOURCE в action-log.service). `crm` — запросы и
 * ошибки CRM продавцов: в основном журнале видны, помечены в панели. `polza` —
 * ошибки Polza.ai (ИИ), проставляется по классу ошибки, как `yandex`. `ozon` —
 * ошибки Ozon Seller API, так же по классу.
 */
export type TErrorSource =
  | 'bot'
  | 'http'
  | 'queue'
  | 'process'
  | 'yandex'
  | 'scanner'
  | 'crm'
  | 'polza'
  | 'ozon'
  | 'wb'
  /** Инструменты ИИ (TASK-147): сбой чтения данных продавца, а не самой Polza. */
  | 'ai';

/**
 * Владелец записи, когда пользователя нет: ошибка HTTP-слоя, падение процесса,
 * сбой фоновой задачи вне контекста пользователя.
 *
 * Поле telegramUserId в схеме обязательное, и подставлять сюда пустую строку
 * нельзя: она молча совпадёт с фильтром «все». Строка `system` заметна глазами
 * и не может быть перепутана с настоящим id — те состоят из цифр.
 */
export const SYSTEM_USER = 'system';

/** Сколько символов стека хранить: полный стек Node — это килобайты на запись. */
const MAX_STACK_LENGTH = 2000;

/** User-Agent сканеров бывает мусорным и длинным — для разбора хватает начала. */
const MAX_USER_AGENT_LENGTH = 300;

export interface IErrorReport {
  error: unknown;
  /** Слой, на котором поймали. Для ошибок Яндекса заменяется на `yandex`. */
  source: TErrorSource;
  /** Короткая метка места: `report:profit`, `stock-upload`, `digest`. */
  context: string;
  telegramUserId?: string;
  username?: string;
  chatId?: string;
  botId?: string;
  /** Что пользователь делал: команда, кнопка, путь запроса. */
  action?: string;
  httpStatus?: number;
  requestUrl?: string;
  /**
   * `out` — сломался вызов, который делал БОТ (отправка в Telegram). По
   * умолчанию `in`: ошибка обработки того, что пришло.
   */
  direction?: 'in' | 'out';
  /** Сколько длился упавший вызов. */
  durationMs?: number;
  /** Слать ли алерт администраторам. По умолчанию да. */
  alert?: boolean;
  /**
   * Плоские подробности для разбора в админке: reportId, времена Маркета и
   * т. п. У ReportGenerationError заполняются сами.
   */
  details?: Record<string, string | number>;
  /** Адрес и User-Agent клиента — у HTTP-ошибок (AllExceptionsFilter). */
  ip?: string;
  userAgent?: string;
}

/** Ошибка драйвера pg внутри DrizzleQueryError: у неё есть `code` Postgres или Node. */
function queryCauseOf(
  error: DrizzleQueryError,
): { message?: string; code?: string; stack?: string } | undefined {
  const cause = error.cause as { message?: unknown; code?: unknown; stack?: unknown } | undefined;
  if (!cause || typeof cause !== 'object') return undefined;
  return {
    message: typeof cause.message === 'string' ? cause.message : undefined,
    code: typeof cause.code === 'string' ? cause.code : undefined,
    stack: typeof cause.stack === 'string' ? cause.stack : undefined,
  };
}

/**
 * Причина сбоя запроса — ВПЕРЕДИ текста drizzle. Его `message` — это
 * `Failed query: <весь SQL>\nparams: …`, а настоящая причина (обрыв, таймаут пула,
 * ошибка Postgres) лежит в `cause`: без неё в алерте оставался один SQL, обрезанный
 * на 500 символах (прод 26-10-2026).
 */
function causePrefixOf(error: unknown): string {
  if (!(error instanceof DrizzleQueryError)) return '';
  const cause = queryCauseOf(error);
  if (!cause?.message) return '';
  return `${cause.message}${cause.code ? ` [${cause.code}]` : ''} · `;
}

/** Как отправить алерт. Подставляется телеграм-слоем, см. ErrorAlertBridge. */
export type TAlertSender = (text: string) => Promise<void>;

/**
 * Единственная точка записи ошибок.
 *
 * Пишет в тот же журнал, что и действия (`actionlogs`), а не в отдельную
 * коллекцию: вопрос всегда звучит как «что человек делал, когда сломалось», и
 * ответ на него — соседние строки одной ленты, а не сверка двух списков по
 * времени.
 */
@Injectable()
export class ErrorReporter {
  private readonly logger = new Logger(ErrorReporter.name);
  private readonly throttle = new AlertThrottle();
  private alertSender?: TAlertSender;

  constructor(private readonly logs: ActionLogService) {}

  /**
   * Телеграм-слой отдаёт сюда способ достучаться до администраторов.
   *
   * Через сеттер, а не через конструктор, потому что отправка требует
   * BotRegistry, а тот сам зовёт ErrorReporter из telegraf.catch — прямая
   * зависимость дала бы цикл в DI. Пока отправитель не подставлен, алерты
   * просто не уходят, а запись в журнал работает.
   */
  public setAlertSender(sender: TAlertSender): void {
    this.alertSender = sender;
  }

  /**
   * Отправить администраторам сообщение, которое ошибкой не является:
   * «MongoDB снова доступна», «место на диске в норме».
   *
   * Живёт здесь, а не в отдельном сервисе, потому что способ достучаться до
   * администраторов уже здесь — это alertSender из ErrorAlertBridge. Второй мост
   * означал бы второе место, где алерт может потеряться.
   *
   * Троттлинга НЕТ намеренно: он остаётся на вызывающем. У AlertThrottle окно в
   * 15 минут на пару «тип ошибки + место», и оно проглотило бы, например,
   * переход «мало места» → «места нет» через пять минут после предупреждения —
   * то есть самый важный сигнал. Кто зовёт этот метод, тот и решает, когда.
   *
   * Текст экранируется здесь же: он уходит с parse_mode: HTML, а в сообщениях
   * ioredis и mongoose легко встречается `<`. Разметку передавать сюда нельзя.
   */
  public notifyAdmins(text: string): void {
    const sender = this.alertSender;
    if (!sender) return;

    void sender(esc(text)).catch((error: Error) => {
      this.logger.warn(`Не удалось отправить сообщение администраторам: ${error.message}`);
    });
  }

  /**
   * Записать ошибку. НИКОГДА не бросает и никогда не ждёт отправки алерта:
   * ловитель, который роняет приложение или задерживает ответ пользователю,
   * хуже отсутствующего.
   */
  public async report(input: IErrorReport): Promise<void> {
    try {
      const error = input.error;
      // Ошибки внешних API (Яндекс, Polza, Ozon, WB) описывают себя сами: класс
      // решает source, статус и адрес запроса едут в полях, а не в тексте.
      const api =
        error instanceof YandexApiError ||
        error instanceof PolzaApiError ||
        error instanceof OzonApiError ||
        error instanceof WbApiError
          ? error
          : undefined;
      const report = error instanceof ReportGenerationError ? error : undefined;

      const errorType = this.typeOf(error);
      const message = this.messageOf(error);
      const source = this.sourceOf(error, input.source);
      const httpStatus = input.httpStatus ?? api?.status;
      const requestUrl = input.requestUrl ?? api?.request ?? report?.request;
      const details = input.details ?? report?.details;

      this.logger.error(
        `[${source}/${input.context}] ${errorType}: ${message}` +
          (requestUrl ? ` · ${requestUrl}` : '') +
          (input.telegramUserId ? ` · пользователь ${input.telegramUserId}` : ''),
      );

      await this.logs.record({
        telegramUserId: input.telegramUserId ?? SYSTEM_USER,
        username: input.username,
        botId: input.botId ?? SYSTEM_USER,
        chatId: input.chatId,
        direction: input.direction ?? 'in',
        kind: 'error',
        action: input.action ?? input.context,
        status: 'error',
        error: message,
        source,
        errorType,
        stack: this.stackOf(error),
        httpStatus,
        requestUrl,
        context: input.context,
        durationMs: input.durationMs,
        details,
        ip: input.ip,
        userAgent: input.userAgent ? truncate(input.userAgent, MAX_USER_AGENT_LENGTH) : undefined,
      });

      if (input.alert !== false) {
        this.sendAlert({ errorType, message, source, requestUrl, input });
      }
    } catch (failure) {
      // Сюда попасть можно только при ошибке в самом ловителе. Молчать нельзя,
      // но и бросать некуда — вызывающий код уже обрабатывает свою ошибку.
      this.logger.warn(`Не удалось записать ошибку в журнал: ${(failure as Error).message}`);
    }
  }

  /** Ошибки внешних API несут свой source независимо от слоя, где их поймали — слой остаётся в context. */
  private sourceOf(error: unknown, fallback: TErrorSource): TErrorSource {
    if (error instanceof YandexApiError) return 'yandex';
    if (error instanceof PolzaApiError) return 'polza';
    if (error instanceof OzonApiError) return 'ozon';
    if (error instanceof WbApiError) return 'wb';
    return fallback;
  }

  /**
   * Имя класса — по нему ошибки группируются и троттлятся алерты.
   *
   * У ошибки Telegram имя класса бесполезно (telegraf не задаёт `name`, и
   * выходит голое `Error`), поэтому тип несёт код ответа: `TelegramError:403`.
   * Заодно 429 и 403 троттлятся раздельно — лимит не прячется за блокировками.
   */
  private typeOf(error: unknown): string {
    const { code } = telegramErrorInfo(error);
    if (code !== undefined) return `TelegramError:${code}`;
    // `name` у класса drizzle не задан — без этого любой сбой Postgres был бы «Error».
    // Код Postgres (57014, 53300…) в типе: таймаут и нехватку соединений троттлим раздельно.
    if (error instanceof DrizzleQueryError) {
      const pgCode = queryCauseOf(error)?.code;
      return pgCode ? `DrizzleQueryError:${pgCode}` : 'DrizzleQueryError';
    }
    if (error instanceof Error) return error.name || error.constructor.name;
    return typeof error === 'string' ? 'StringError' : 'UnknownError';
  }

  /**
   * Сообщение проходит маскировку подписанного токена, но НЕ числовую: та
   * изуродовала бы коды ответов и суммы, а токен бот никогда не отправляет —
   * он его только принимает.
   */
  private messageOf(error: unknown): string {
    const { retryAfter } = telegramErrorInfo(error);
    const raw =
      causePrefixOf(error) +
      (error instanceof Error ? error.message : String(error)) +
      (retryAfter !== undefined ? ` · retry after ${retryAfter} s` : '');
    return truncate(maskOutgoing(raw || 'без сообщения'), 500);
  }

  private stackOf(error: unknown): string | undefined {
    if (!(error instanceof Error) || !error.stack) return undefined;
    const cause = error instanceof DrizzleQueryError ? queryCauseOf(error)?.stack : undefined;
    const stack = cause ? `${cause}\n--- обёрнуто в ---\n${error.stack}` : error.stack;
    return truncate(maskOutgoing(stack), MAX_STACK_LENGTH);
  }

  /** Отправка не ожидается: алерт не должен задерживать обработку ошибки. */
  private sendAlert(payload: {
    errorType: string;
    message: string;
    source: string;
    requestUrl?: string;
    input: IErrorReport;
  }): void {
    const sender = this.alertSender;
    if (!sender) return;

    const { errorType, message, source, requestUrl, input } = payload;

    // Ключ — вид ошибки и место, а НЕ текст сообщения: в тексте бывает id
    // заказа или артикул, и тогда каждая ошибка выглядит новой, а троттлинг
    // не срабатывает никогда.
    if (!this.throttle.allow(`${errorType}:${input.context}`, Date.now())) return;

    // Экранируем: сообщение ошибки уходит в HTML-разметку, а в нём легко
    // встречается `<` — например, в тексте про несовпадение типов.
    const lines = [
      `🚨 <b>${esc(errorType)}</b>`,
      `Место: ${esc(source)} / ${esc(input.context)}`,
      input.telegramUserId ? `Пользователь: ${esc(input.telegramUserId)}` : null,
      requestUrl ? `Запрос: ${esc(requestUrl)}` : null,
      '',
      esc(message),
    ].filter(Boolean);

    void sender(lines.join('\n')).catch((error: Error) => {
      this.logger.warn(`Не удалось отправить алерт: ${error.message}`);
    });
  }
}
