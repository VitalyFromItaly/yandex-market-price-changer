import type { YandexMarketDocument } from '../../../database/schemas/yandex-market.schema';
import type { IReportInfo, YandexApiClient } from '../yandex-api.client';
import type { TFbyStockError } from './fby-message';
import type { IFbyStockSummary } from './fby-stock-report';

import { Injectable } from '@nestjs/common';

import { ErrorReporter } from '../../errors/error-reporter.service';
import { ReportGenerationError } from '../report-generation.error';
import { YandexClientFactory } from '../yandex-client.factory';
import { realSleep, type TSleep } from '../yandex-retry';

import { parseFbyStockReport } from './fby-stock-report';

/**
 * Добыча остатков FBY: generate → поллинг → скачивание → разбор.
 *
 * Почему это отдельный сервис, а не приватный метод FbyService. Остатки по
 * складам нужны ДВУМ экранам — «📦 FBY» (свёртка по кластерам) и «🏬 Склады»
 * (числа под каждым складом), — а генерация отчёта лимитирована 1/мин на
 * бизнес. Значит нужен ровно один цикл добычи и ровно одно место, где живёт
 * состояние этого лимита. Инжектить ради этого FbyService в WarehousesService
 * значило бы поставить сервис одного экрана в зависимость от СБОРЩИКА другого
 * (тот возвращает готовый текст и xlsx, знает про пороги вывода и тянет
 * OrderReportsService) — инверсия слоя, из-за которой завтра любая новая
 * зависимость сводки молча приезжает в экран складов.
 *
 * API-only: читает Partner API, ничего не пишет и не трогает Mongo.
 */

/**
 * Сколько считаем разбор свежим. Ровно окно лимита генерации: держать дольше —
 * показывать старое там, где Маркет уже разрешил обновить. К 10-2026 лимит без
 * подписки — 1 запрос в 2 минуты (с подпиской Medium — 1/мин), поэтому окно
 * под худший случай.
 */
const STOCK_MEMO_TTL_MS = 120_000;

/**
 * Сколько помним отчёт, который не дождались. Маркет держал отчёт в очереди
 * до 50 минут (13-10-2026: принят 03:39Z, провален 04:29Z), а каждое новое
 * нажатие ставило ему в очередь ЕЩЁ один. Повторный вызов в этом окне
 * продолжает опрос того же reportId.
 */
const PENDING_REPORT_TTL_MS = 60 * 60_000;

/**
 * Поллинг отчёта: интервал и потолок. Генерация обычно ~10 c, но на живом
 * магазине бывала дольше 50 c, а 12-10-2026 дважды подряд не уложилась и в
 * прежние 3 минуты — Маркет принял генерацию и просто долго её делал, а мы
 * сдавались раньше. Потолок 10 минут безопасен, потому что все экраны
 * собираются в фоне (процессоры очереди reports, фоновые задачи CRM), а не в
 * цикле апдейтов telegraf. Интервал поднят вместе с потолком: лишние 5 с на
 * обычном отчёте ничего не стоят, а опросов за 10 минут столько же, сколько
 * раньше за 5.
 */
const POLL_INTERVAL_MS = 5000;
export const POLL_MAX_ATTEMPTS = 120;

/**
 * Повторы новой генерации после FAILED. Маркет проваливает этот отчёт сам и
 * случайно: 13.10, 20.10 и 13.11.2026 — FAILED за 0,4–3 с без subStatus; прогон
 * diagnose-fby-stock 13.11 по FBY-кампании дал 4 провала из 6 вперемешку с
 * успехами, одинаково в CSV и JSON. Значит формат и кампания ни при чём, а тот же
 * запрос минутой позже проходит. Два повтора (три попытки), а не один: при
 * сегодняшней доле отказов ~2/3 один повтор спасал бы лишь половину случаев.
 * Пауза — окно лимита генерации (1 в 2 минуты) с запасом; всё идёт в фоне.
 */
export const FAILED_RETRIES = 2;
export const RETRY_AFTER_FAILED_MS = 130_000;

/** Последний провал с перечнем прежних: админ видит, что повторы были. */
function withEarlierAttempts(
  error: ReportGenerationError,
  earlier: string[],
): ReportGenerationError {
  return new ReportGenerationError(
    `${error.message} — после ${earlier.length + 1} попыток (прежние отчёты: ${earlier.join(', ')})`,
    error.reportId,
    error.info,
    error.waitedMs,
  );
}

/** Разбор отчёта вместе с моментом, НА который сняты остатки. */
export interface IFbyStockSnapshot {
  summary: IFbyStockSummary;
  /**
   * Момент съёмки, а не показа: при попадании в мемо разбор до минуты старше
   * экрана, и экран обязан это напечатать — снимок без времени нечем сверить
   * с кабинетом (приём «Едет до клиента»).
   */
  takenAt: Date;
}

/** Результат мягкой добычи: либо снимок, либо причина, почему его нет. */
export interface IFbyStockResult {
  snapshot: IFbyStockSnapshot | null;
  error?: TFbyStockError;
}

/** Что известно про кампанию: идущая добыча либо свежий разбор. */
interface IStockMemoEntry {
  inFlight?: Promise<IFbyStockSnapshot>;
  snapshot?: IFbyStockSnapshot;
  freshUntil?: number;
}

@Injectable()
export class FbyStockService {
  private readonly sleep: TSleep = realSleep;

  /**
   * Ключ — `business:campaign`. Данные принадлежат кампании (у бизнеса их
   * может быть несколько), а лимит — бизнесу; ключуем по кампании, потому что
   * показать чужие остатки хуже, чем лишний раз упереться в лимит.
   */
  private readonly memo = new Map<string, IStockMemoEntry>();

  /** Отчёт, не готовый к потолку ожидания: `business:campaign` → reportId. */
  private readonly pending = new Map<string, { reportId: string; until: number }>();

  constructor(
    private readonly clients: YandexClientFactory,
    private readonly errors: ErrorReporter,
  ) {}

  /**
   * Остатки с защитой от лимита: параллельный вызов ждёт ту же добычу, повтор
   * в пределах минуты берёт готовый разбор. Не бросает — на rate-limit и на
   * сбое отдаёт причину, потому что оба экрана обязаны деградировать мягко:
   * список складов и заявки ценны и без остатков.
   */
  public async safeLoad(store: YandexMarketDocument): Promise<IFbyStockResult> {
    try {
      return { snapshot: await this.fresh(store) };
    } catch (error) {
      const rateLimited = /rate limit|METHOD_FAILURE|1 point per 1 minute/i.test(
        error instanceof Error ? error.message : String(error),
      );
      // Лимит генерации 1/мин — это не поломка, а «подождите»: не спамим админов.
      if (!rateLimited) {
        void this.errors.report({
          error,
          source: 'yandex',
          context: 'fby:stock',
          telegramUserId: store.telegramUserId,
          action: 'остатки FBY',
        });
      }
      return { snapshot: null, error: rateLimited ? 'rate_limit' : 'generic' };
    }
  }

  /**
   * Свежий разбор: из мемо, из идущей добычи или новой генерацией.
   *
   * Из этого следует главное свойство: следующая генерация для той же кампании
   * стартует не раньше, чем через TTL ПОСЛЕ завершения предыдущей, а завершение
   * позже старта — значит интервал между генерациями всегда больше минуты и
   * лимит недостижим по построению. Без этого второй экран проектно проигрывал
   * бы гонку первому.
   */
  private fresh(store: YandexMarketDocument): Promise<IFbyStockSnapshot> {
    const key = this.keyOf(store);
    const now = Date.now();
    this.prune(now);

    const entry = this.memo.get(key);
    if (entry?.inFlight) return entry.inFlight;
    if (entry?.snapshot && entry.freshUntil > now) return Promise.resolve(entry.snapshot);

    const inFlight = this.load(store).then(
      (snapshot) => {
        this.memo.set(key, { snapshot, freshUntil: Date.now() + STOCK_MEMO_TTL_MS });
        return snapshot;
      },
      (error) => {
        // Отказ НЕ запоминаем: иначе разовый сбой залипал бы на минуту, и
        // повторное нажатие кнопки ничего бы не чинило.
        this.memo.delete(key);
        throw error;
      },
    );

    this.memo.set(key, { inFlight });
    return inFlight;
  }

  /**
   * Полный цикл добычи. Бросает — мягкость это дело safeLoad.
   *
   * Отчёт, не дождавшийся прошлого раза, продолжаем, а не заказываем заново:
   * новый встал бы в ту же очередь Маркета позади старого. Забываем его на
   * любом окончательном ответе — файл получен или Маркет сказал FAILED.
   *
   * FAILED свежей генерации повторяем новой генерацией до FAILED_RETRIES раз
   * (см. константу); бросаем последний провал с перечнем прежних reportId.
   */
  public async load(store: YandexMarketDocument): Promise<IFbyStockSnapshot> {
    const key = this.keyOf(store);
    const client = this.clients.forStore(store);
    const waiting = this.pending.get(key);
    const resumed = waiting && waiting.until > Date.now();
    let reportId = resumed ? waiting.reportId : await client.generateStocksOnWarehousesReport();
    const failedIds: string[] = [];

    let fileUrl: string;
    for (;;) {
      try {
        fileUrl = await this.pollReport(client, reportId);
        break;
      } catch (error) {
        const failed = error instanceof ReportGenerationError && error.info?.status === 'FAILED';
        if (!failed && error instanceof ReportGenerationError) {
          this.pending.set(key, { reportId, until: Date.now() + PENDING_REPORT_TTL_MS });
          throw error;
        }
        this.pending.delete(key);
        // Продолженный отчёт не повторяем: он уже стоял в очереди Маркета, а
        // его провал — ответ по нему, а не мгновенный сбой новой генерации.
        if (!failed) throw error;
        if (resumed || failedIds.length >= FAILED_RETRIES) {
          throw failedIds.length ? withEarlierAttempts(error, failedIds) : error;
        }
        failedIds.push(reportId);
        await this.sleep(RETRY_AFTER_FAILED_MS);
        reportId = await client.generateStocksOnWarehousesReport();
      }
    }
    this.pending.delete(key);

    const buffer = await client.downloadReportFile(fileUrl);
    return { summary: parseFbyStockReport(buffer), takenAt: new Date() };
  }

  private keyOf(store: YandexMarketDocument): string {
    return `${store.business_id}:${store.campaign_id}`;
  }

  /**
   * Ждём готовности отчёта. Бросает на FAILED и на исчерпании попыток.
   *
   * В ошибку исчерпания попадает последний статус: «не готов вовремя» без
   * него не отличает отчёт, застрявший в очереди Маркета (PENDING), от долгой
   * сборки (PROCESSING) и от статуса, которого мы не знаем. Текст видят только
   * админы — продавцу уходит fbyStockUnavailableLine.
   */
  private async pollReport(client: YandexApiClient, reportId: string): Promise<string> {
    const startedAt = Date.now();
    let last: IReportInfo | undefined;
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
      const info = await client.getReportInfo(reportId);
      last = info;
      if (info.status === 'DONE' && info.fileUrl) return info.fileUrl;
      if (info.status === 'FAILED') {
        const reason = info.subStatus ? ` (Маркет: ${info.subStatus})` : '';
        throw new ReportGenerationError(
          `Отчёт об остатках FBY не сгенерировался${reason}`,
          reportId,
          info,
          Date.now() - startedAt,
        );
      }
      await this.sleep(POLL_INTERVAL_MS);
    }
    const minutes = Math.round((POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS) / 60_000);
    throw new ReportGenerationError(
      `Отчёт об остатках FBY не готов за ${minutes} мин (последний статус: ${last?.status ?? 'нет ответа'})`,
      reportId,
      last,
      Date.now() - startedAt,
    );
  }

  /** Протухшие записи выбрасываем — иначе разбор магазина живёт вечно. */
  private prune(now: number): void {
    for (const [key, entry] of this.memo) {
      if (!entry.inFlight && entry.freshUntil <= now) this.memo.delete(key);
    }
  }
}
