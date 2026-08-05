import type { YandexMarketDocument } from '../../../database/schemas/yandex-market.schema';
import type { YandexApiClient } from '../yandex-api.client';
import type { TFbyStockError } from './fby-message';
import type { IFbyStockSummary } from './fby-stock-report';

import { Injectable } from '@nestjs/common';

import { ErrorReporter } from '../../errors/error-reporter.service';
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
 * Сколько считаем разбор свежим. Ровно окно лимита генерации (1/мин на бизнес):
 * держать дольше — показывать старое там, где Маркет уже разрешил обновить.
 */
const STOCK_MEMO_TTL_MS = 60_000;

/**
 * Поллинг отчёта: интервал и потолок. Генерация обычно ~10 c, но на живом
 * магазине бывала дольше 50 c («Отчёт об остатках FBY не готов вовремя»).
 * Потолок ~3 минуты безопасен, потому что оба экрана собираются в фоне
 * (процессоры очереди reports), а не в цикле апдейтов telegraf.
 */
const POLL_INTERVAL_MS = 2500;
const POLL_MAX_ATTEMPTS = 72;

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
    const key = `${store.business_id}:${store.campaign_id}`;
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

  /** Полный цикл добычи. Бросает — мягкость это дело safeLoad. */
  public async load(store: YandexMarketDocument): Promise<IFbyStockSnapshot> {
    const client = this.clients.forStore(store);
    const reportId = await client.generateStocksOnWarehousesReport();
    const fileUrl = await this.pollReport(client, reportId);
    const buffer = await client.downloadReportFile(fileUrl);
    return { summary: parseFbyStockReport(buffer), takenAt: new Date() };
  }

  /** Ждём готовности отчёта. Бросает на FAILED и на исчерпании попыток. */
  private async pollReport(client: YandexApiClient, reportId: string): Promise<string> {
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
      const info = await client.getReportInfo(reportId);
      if (info.status === 'DONE' && info.fileUrl) return info.fileUrl;
      if (info.status === 'FAILED') throw new Error('Отчёт об остатках FBY не сгенерировался');
      await this.sleep(POLL_INTERVAL_MS);
    }
    throw new Error('Отчёт об остатках FBY не готов вовремя');
  }

  /** Протухшие записи выбрасываем — иначе разбор магазина живёт вечно. */
  private prune(now: number): void {
    for (const [key, entry] of this.memo) {
      if (!entry.inFlight && entry.freshUntil <= now) this.memo.delete(key);
    }
  }
}
