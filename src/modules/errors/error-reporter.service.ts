import { Injectable, Logger } from '@nestjs/common';

import { ActionLogService } from '../../database/services/action-log.service';
import { maskOutgoing, truncate } from '../telegram/bots/shared/action-log.domain';
import { esc } from '../telegram/formatting/telegram-format';
import { YandexApiError } from '../yandex/yandex-api.errors';

import { AlertThrottle } from './alert-throttle';

/**
 * Откуда прилетела ошибка. `scanner` — внешний сканер секретов (404 на
 * несматченный маршрут); такие записи прячутся из основного журнала и живут во
 * вкладке «Мусор» (см. JUNK_SOURCE в action-log.service).
 */
export type TErrorSource = 'bot' | 'http' | 'queue' | 'process' | 'yandex' | 'scanner';

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
  /** Слать ли алерт администраторам. По умолчанию да. */
  alert?: boolean;
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
      const isYandex = error instanceof YandexApiError;

      const errorType = this.typeOf(error);
      const message = this.messageOf(error);
      const source = isYandex ? 'yandex' : input.source;
      const httpStatus = input.httpStatus ?? (isYandex ? error.status : undefined);
      const requestUrl = input.requestUrl ?? (isYandex ? error.request : undefined);

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
        direction: 'in',
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

  /** Имя класса — по нему ошибки группируются и троттлятся алерты. */
  private typeOf(error: unknown): string {
    if (error instanceof Error) return error.name || error.constructor.name;
    return typeof error === 'string' ? 'StringError' : 'UnknownError';
  }

  /**
   * Сообщение проходит маскировку подписанного токена, но НЕ числовую: та
   * изуродовала бы коды ответов и суммы, а токен бот никогда не отправляет —
   * он его только принимает.
   */
  private messageOf(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error);
    return truncate(maskOutgoing(raw || 'без сообщения'), 500);
  }

  private stackOf(error: unknown): string | undefined {
    if (!(error instanceof Error) || !error.stack) return undefined;
    return truncate(maskOutgoing(error.stack), MAX_STACK_LENGTH);
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
