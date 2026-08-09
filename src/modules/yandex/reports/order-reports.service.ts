import { Injectable, Logger } from '@nestjs/common';
import { YandexClientFactory } from '../yandex-client.factory';
import type { YandexMarketDocument } from '../../../database/schemas/yandex-market.schema';
import type {
  IOrdersQuery,
  IOrdersStatsQuery,
  IReturnRecord,
  YandexApiClient,
} from '../yandex-api.client';
import {
  PLACED_DEFINITION,
  REPORT,
  RETURN_ACTIVE_STATUSES,
  RETURN_SHIPMENT_STATUSES,
  effectiveDefinition,
  isAssembling,
  isCancelled,
  matchesDefinition,
  queryStatuses,
  reportDefinition,
  returnStage,
  type IReportContext,
  type IReportDefinition,
  type TReportKey,
} from './report-status-map';
import { isFby, placementOfCampaign } from '../stocks/placement';
import {
  addTotals,
  amountValue,
  orderTotals,
  ZERO_TOTALS,
  type IMoneyTotals,
  type IOrderSubsidy,
} from './money';
import { moscowClock, moscowDateParam } from './moscow-day';
import {
  DEFAULT_PERIOD,
  assertPeriodOrdered,
  assertPeriodSupported,
  creationDateParams,
  isUnbounded,
  periodAgeDays,
  periodBounds,
  periodWindows,
  shipmentDateParams,
  updatedAtParams,
  withinPeriod,
  type IPeriodBounds,
  type IReportPeriod,
} from './report-period';
import {
  statsCreationParams,
  statsOrderToReportOrder,
  statsUpdateParams,
  toStatsStatuses,
} from './stats-orders';
import { HISTORY_WINDOW_DAYS } from '../yandex-api.paths';
import {
  buildOrdersWorkbook,
  buildReturningWorkbook,
  returningFileName,
  shippedFileName,
  workbookFileName,
} from './report-workbook';
import { formatReport } from './report-message';

/**
 * Позиция заказа в объёме, нужном отчётам.
 *
 * `offerId` — артикул продавца, тот же, что в каталоге и в закупочных ценах.
 * Устаревший синоним `shopSku` не используем: документация прямо велит брать
 * `offerId`, а имя из списка устаревших полей ещё и запрещено тестом.
 *
 * Позиции ПРИХОДИЛИ всегда: `getOrders` отдаёт ответ Яндекса как есть, а отчёты
 * лишь кастуют его к этому интерфейсу. Расширение типа не добавляет ни запроса,
 * ни расхода квоты — только перестаёт выбрасывать уже полученные данные.
 */
export interface IReportOrderItem {
  offerId?: string;
  offerName?: string;
  count?: number;
  /**
   * Цена продажи за ЕДИНИЦУ, без вознаграждения за скидки Маркета (subsidies).
   * Нужна прибыли: комиссия за продвижение считается от ценника товара.
   */
  price?: number;
}

/** Заказ в объёме, нужном отчётам. */
export interface IReportOrder {
  id?: number;
  status?: string;
  substatus?: string;
  creationDate?: string;
  itemsTotal?: number;
  deliveryTotal?: number;
  /**
   * Субсидии Маркета — итог по типам на весь заказ.
   *
   * Нужны прибыли: это вознаграждение партнёру, то есть выручка продавца сверх
   * платежа покупателя (см. subsidiesTotal в money.ts). Приходили всегда, просто
   * не читались — за июль в них 421 тыс. ₽.
   */
  subsidies?: IOrderSubsidy[];
  items?: IReportOrderItem[];
}

/**
 * Результат выгрузки: либо файл, либо объяснение, почему файла нет.
 *
 * Плоская структура, а не дискриминированное объединение: в проекте выключен
 * strictNullChecks, и сужение по литеральному `empty: true` не работает —
 * компилятор просто не даст обратиться к полям файла.
 */
export interface IReportExport {
  empty: boolean;
  /** Заполнено при empty === true. */
  message?: string;
  /** Заполнены при empty === false. */
  buffer?: Buffer;
  filename?: string;
  caption?: string;
}

/**
 * Возвраты отчёта отдельным блоком.
 *
 * `count` уже входит в общий `IReportResult.count`, но разбивка нужна тексту:
 * «возвратов 41» не отвечает на вопрос, ради которого кнопку жмут, — сколько
 * ещё ЕДЕТ. Сумма `inFlight` — то самое число, что продавец видит в кабинете.
 */
export interface IReturnsSummary {
  count: number;
  totals: IMoneyTotals;
  /** Едут к продавцу: принят у покупателя, в пути, ждёт в пункте выдачи. */
  inFlight: number;
  /** Уже выданы магазину — путь закончен. */
  settled: number;
  /**
   * Ровно те записи, что вошли в `count`: после фильтра периода и
   * дедупликации по orderId. Нужны выгрузке .xlsx — файл обязан сходиться с
   * числами в сообщении по построению, а не по совпадению фильтров.
   */
  records: IReturnRecord[];
}

export interface IReportResult {
  key: TReportKey;
  title: string;
  count: number;
  totals: IMoneyTotals;
  orders: IReportOrder[];
  /** За какой период собран — заголовок сообщения печатает именно его. */
  period: IReportPeriod;
  /** Есть только у отчётов с `usesReturnsApi`. */
  returns?: IReturnsSummary;
  /**
   * Заказы собраны через архив stats/orders — текст «Всего» меняет оговорку
   * «не старше 30 дней» на объяснение, что срез полный.
   */
  viaArchive?: boolean;
  /**
   * Сколько из `count` собирается на складе Маркета (FBY). Есть только там, где
   * такие заказы вообще попали в отчёт, то есть при `options.fby`.
   *
   * Считается из ТОГО ЖЕ массива, что дал `count` (довод IReturnsSummary.records):
   * две независимые выборки однажды разойдутся, и продавец увидит разбивку, не
   * сходящуюся с итогом.
   */
  assembling?: number;
}

/**
 * Что сборке разрешено сверх умолчаний.
 *
 * `deepHistory` — фича deep_history: период, начинающийся глубже 30-дневного
 * окна getOrders, идёт через АРХИВНЫЙ метод stats/orders. Решение о флаге
 * принято до вызова (хендлер/payload — паттерн tariffEstimate), сервис
 * UserAccess не читает.
 */
export interface IReportBuildOptions {
  deepHistory?: boolean;
  /**
   * Модель размещения, если вызывающий её уже знает. Иначе сервис определяет
   * сам — кэш `stores`, при промахе живой `listStores`.
   *
   * Определяет ИМЕННО сервис, а не вызывающий (в отличие от deepHistory):
   * deepHistory — фича из UserAccess, куда сервису ходить нельзя, а модель
   * размещения — свойство того самого магазина, который уже передан первым
   * аргументом, и клиент к нему уже построен. Вызывающих же три — кнопка,
   * рассылка и сводка «📦 FBY» (FbyService.safeCount), — и четвёртый забыл бы
   * флаг молча: получилось бы то самое расхождение «в боте одно, в сводке
   * другое».
   */
  placement?: string;
}

/**
 * Четыре отчёта поверх Partner API.
 *
 * Статусы и фильтры даты сюда НЕ зашиты — они читаются из report-status-map.
 * Поэтому «добавьте в „едет обратно“ ещё один подстатус» правится в маппинге и
 * работает здесь без единой правки логики.
 */
@Injectable()
export class OrderReportsService {
  private readonly logger = new Logger(OrderReportsService.name);

  constructor(private readonly clients: YandexClientFactory) {}

  public async build(
    store: YandexMarketDocument,
    key: TReportKey,
    now: Date = new Date(),
    period: IReportPeriod = DEFAULT_PERIOD,
    options: IReportBuildOptions = {},
  ): Promise<IReportResult> {
    const client = this.clients.forStore(store);
    const definition = reportDefinition(key);

    const context: IReportContext = {
      unbounded: isUnbounded(period),
      // За моделью размещения идём ТОЛЬКО там, где она вообще меняет набор:
      // на остальных пяти отчётах это был бы лишний запрос на ровном месте.
      fby: definition.fbyExtraStatuses
        ? isFby(await this.placementOf(store, client, options))
        : false,
    };

    const orders = await this.collectOrders(client, definition, now, period, options, context);
    let totals = orders.reduce<IMoneyTotals>(
      (acc, order) => addTotals(acc, orderTotals(order)),
      ZERO_TOTALS,
    );

    let count = orders.length;
    let returns: IReturnsSummary | undefined;

    if (definition.usesReturnsApi) {
      returns = await this.collectReturns(client, orders, period, now);
      totals = addTotals(totals, returns.totals);
      count += returns.count;
    }

    const viaArchive = this.usesArchive(definition, period, now, options);

    // Разбивка по ТЕМ ЖЕ заказам, что дали count: отдельный фильтр или второй
    // запрос однажды разойдётся с итогом, и продавец увидит разбивку, которая
    // не складывается (довод IReturnsSummary.records).
    const assembling = context.fby ? orders.filter(isAssembling).length : undefined;

    return {
      key,
      title: definition.title,
      count,
      totals,
      orders,
      period,
      returns,
      viaArchive,
      assembling,
    };
  }

  /**
   * Модель размещения магазина. Сначала кэш `stores` (обычный случай — без
   * единого запроса), при промахе — живой listStores тем же клиентом.
   *
   * Сбой сети = «не знаем» = НЕ FBY: расширить отчёт по догадке нельзя, а
   * сузить — это текущее, сверенное с кабинетом поведение. Та же политика,
   * что в placement.ts и StockSyncService.resolvePlacement, только там она
   * защищает ЗАПИСЬ остатков, а здесь — число в отчёте.
   */
  private async placementOf(
    store: YandexMarketDocument,
    client: YandexApiClient,
    options: IReportBuildOptions,
  ): Promise<string | undefined> {
    if (options.placement) return options.placement;

    const cached = placementOfCampaign(store.stores, store.campaign_id);
    if (cached) return cached;

    try {
      return placementOfCampaign(await client.listStores(), store.campaign_id);
    } catch (error) {
      this.logger.warn(
        `Модель размещения не определена, отчёт собран как не-FBY: ${String(error)}`,
      );
      return undefined;
    }
  }

  /**
   * Заказы, ОФОРМЛЕННЫЕ за период, с отменёнными отдельным списком.
   *
   * Отдельный публичный метод, а не отчёт: кнопки и рассылки у этого набора
   * нет, он нужен только прибыли — вторым блоком рядом с выкупленными.
   *
   * Отменённые приходят тем же запросом и разделяются здесь: в кабинете
   * продавец видит их в общем списке, поэтому отчёт про них говорит, но в
   * деньги не берёт.
   */
  public async collectPlacedOrders(
    store: YandexMarketDocument,
    period: IReportPeriod = DEFAULT_PERIOD,
    now: Date = new Date(),
    options: IReportBuildOptions = {},
  ): Promise<{ orders: IReportOrder[]; cancelled: IReportOrder[] }> {
    const client = this.clients.forStore(store);
    const all = await this.collectOrders(client, PLACED_DEFINITION, now, period, options, {
      unbounded: isUnbounded(period),
    });

    return {
      orders: all.filter((order) => !isCancelled(order)),
      cancelled: all.filter((order) => isCancelled(order)),
    };
  }

  /**
   * Заказы отчёта. Фильтр по статусу уходит в запрос, а `matchesDefinition`
   * применяется ПОВЕРХ ответа: подстатус Partner API фильтровать не умеет, и
   * без второй проверки в «едет обратно» попали бы все заказы в доставке.
   *
   * Принимает ОПРЕДЕЛЕНИЕ, а не ключ отчёта: тем же кодом собирается
   * `PLACED_DEFINITION`, у которого ключа нет вовсе.
   *
   * Период уходит НЕ одним запросом: Partner API отвергает интервал длиннее
   * 30 дней, а 31-го числа «с 1 числа месяца» — это 31 день. Окна даёт
   * periodWindows, здесь они просто обходятся подряд (их максимум два, а квота
   * метода часовая — параллелить нечего) и склеиваются с дедупликацией.
   */
  private async collectOrders(
    client: YandexApiClient,
    definition: IReportDefinition,
    now: Date,
    period: IReportPeriod,
    options: IReportBuildOptions = {},
    context: IReportContext = {},
  ): Promise<IReportOrder[]> {
    // «Всего» может иметь собственный срезовый набор статусов, FBY — добавку.
    // Эффективное определение подставляется ОДИН раз и дальше идёт и в запрос,
    // и в отбор ответа, чтобы они не могли разойтись.
    const effective = effectiveDefinition(definition, context);
    const useStats = this.usesArchive(effective, period, now, options);

    // Период проверяем ДО сети — но только там, где он вообще применяется.
    // У среза «что сейчас в пути» фильтра даты нет, и отклонять его из-за
    // слишком старой даты было бы отказом на ровном месте. На архивном пути
    // возраст не ограничен — остаётся только упорядоченность границ.
    if (effective.dateFilter !== 'none' && !isUnbounded(period)) {
      if (useStats) assertPeriodOrdered(period, now);
      else assertPeriodSupported(period, now);
    }

    /**
     * Окон нет в двух случаях, и оба означают «дат в запрос не шлём».
     *
     * `dateFilter: 'none'` — срез «что сейчас в пути», у него периода нет по
     * определению. `PERIOD.ALL` — продавец сам попросил без ограничения; для
     * заказов это не «за всё время», а «сколько отдаст Partner API» (он хранит
     * около 30 дней — если срез не ушёл в архив), и текст отчёта обязан это
     * проговорить.
     */
    const noDates = effective.dateFilter === 'none' || isUnbounded(period);
    // Архив тоже режется теми же 30-дневными окнами: лимит длины интервала в
    // спеке stats не заявлен, но резать безопасно и бесплатно — дедуп по id
    // уже есть (диагностический скрипт пробует и длинный интервал).
    const windows = noDates ? [null] : periodWindows(period, now);

    const collected: IReportOrder[] = [];
    const seen = new Set<number>();

    for (const window of windows) {
      const pages = useStats
        ? client.iterateOrdersStats(this.statsQuery(effective, window))
        : client.iterateOrders(this.ordersQuery(effective, window, now));

      for await (const page of pages) {
        for (const raw of page) {
          // Архивная форма заказа другая — в отчётную её переводит маппер;
          // дальше оба пути неразличимы (matchesDefinition, дедуп, деньги).
          const order = useStats ? statsOrderToReportOrder(raw) : (raw as IReportOrder);
          if (!matchesDefinition(effective, order)) continue;

          // Дедупликация обязательна: границы соседних окон Яндекс трактует
          // сам (диапазон короче суток он растягивает до суток), и заказ с
          // края попал бы в отчёт дважды — и штукой, и суммой.
          if (order.id != null) {
            if (seen.has(order.id)) continue;
            seen.add(order.id);
          }

          collected.push(order);
        }
      }
    }

    return collected;
  }

  /**
   * Идёт ли сбор через архив stats/orders. ОДНО место решения: то же условие
   * нужно и collectOrders (выбор метода), и build (оговорка в тексте отчёта) —
   * два независимых вычисления однажды разойдутся.
   *
   * Два случая:
   * - ограниченный период глубже 30 дней — прежний путь deep_history; архиву
   *   по силам не всё: у stats нет фильтра по дате ОТГРУЗКИ (конкретные дни
   *   shipped_today) и нет подстатусов (returning) — те остаются в 30-дневном
   *   окне даже под флагом;
   * - «Всего» у определения с собственным срезовым набором (unboundedStatuses):
   *   это снимок «сейчас», getOrders без дат отдаёт ~30 дней, архив — всё.
   *   Дат в запрос архива не уходит, поэтому отсутствие у stats фильтра даты
   *   отгрузки здесь не мешает. Дискриминатор — наличие unboundedStatuses, не
   *   отдельный флаг: «у Всего свой срезовый набор» и «Всего — снимок, которому
   *   нужна глубина» — одно продуктовое решение (у REDEEMED «всё выкупленное за
   *   всю историю» не нужно никому — довод 1979 возвратов).
   *
   * Период идёт через ОДИН источник целиком: сшивать источники внутри одного
   * периода нельзя — формы заказов различаются системно, и дедуп по id не спас
   * бы от расхождения денег.
   */
  private usesArchive(
    definition: IReportDefinition,
    period: IReportPeriod,
    now: Date,
    options: IReportBuildOptions,
  ): boolean {
    if (!options.deepHistory) return false;
    if (isUnbounded(period)) return !!definition.unboundedStatuses;

    const deepCapable =
      definition.dateFilter === 'creationDate' || definition.dateFilter === 'updatedAt';
    return deepCapable && periodAgeDays(period, now) > HISTORY_WINDOW_DAYS;
  }

  /**
   * Запрос к архиву за одним окном. Статусы — из ПОЛНОГО определения через
   * `toStatsStatuses`: у архива свой enum фильтра, шире getOrders
   * (QUERYABLE_STATUSES тут ни при чём).
   */
  private statsQuery(
    definition: IReportDefinition,
    window: IPeriodBounds | null,
  ): IOrdersStatsQuery {
    const query: IOrdersStatsQuery = { statuses: toStatsStatuses(definition.statuses) };
    if (!window) return query;

    if (definition.dateFilter === 'updatedAt') {
      return { ...query, ...statsUpdateParams(window) };
    }
    return { ...query, ...statsCreationParams(window) };
  }

  /** Запрос за одним окном периода. */
  private ordersQuery(
    definition: IReportDefinition,
    window: IPeriodBounds | null,
    now: Date,
  ): IOrdersQuery {
    // В запрос уходят только те статусы, которые Partner API принимает в
    // фильтре: запрещённое значение отвечает 400 на ВЕСЬ отчёт (см. queryStatuses).
    const query: IOrdersQuery = { status: queryStatuses(definition) };
    if (!window) return query;

    switch (definition.dateFilter) {
      case 'supplierShipmentDate': {
        const range = shipmentDateParams(window);
        query.supplierShipmentDateFrom = range.from;
        query.supplierShipmentDateTo = range.to;
        break;
      }
      case 'updatedAt': {
        const range = updatedAtParams(window, now);
        query.updatedAtFrom = range.from;
        query.updatedAtTo = range.to;
        break;
      }
      case 'creationDate': {
        // Верхняя граница у Яндекса исключающая — сдвиг на день делает
        // creationDateParams, см. комментарий там.
        const range = creationDateParams(window);
        query.fromDate = range.from;
        query.toDate = range.to;
        break;
      }
      default:
        // 'none' — срез «что сейчас», фильтр даты не нужен.
        break;
    }

    return query;
  }

  /**
   * Возвраты из отдельного метода — с фильтром по периоду НА НАШЕЙ стороне.
   *
   * Дат метод возвратов не принимает вовсе: в запросе только pageToken, limit и
   * shipmentStatuses. Пока фильтра здесь не было, половина отчёта резалась по
   * периоду, а половина — нет, и «за сегодня» с «с 1 числа месяца» давали
   * одинаковый набор возвратов. Именно так это и выглядело у продавца: число к
   * выбранному месяцу отношения не имело.
   *
   * Режем по `creationDate` — дате ОФОРМЛЕНИЯ возврата: «возвраты за август» это
   * про то, что случилось в августе, а не про то, что в августе обновилось.
   * На `PERIOD.ALL` не режем вовсе.
   *
   * Набор стадий зависит от того, есть ли период:
   *
   * - ЗА ПЕРИОД спрашиваем все пять — продавцу нужна полная картина месяца,
   *   включая уже выданные. С единственным IN_TRANSIT отчёт показывал 38
   *   возвратов там, где в кабинете 50;
   * - на «ВСЕГО» — только активные. «Все возвраты за всё время» это 2137 записей,
   *   из которых 2011 уже закрыты: число, которое ни о чём не говорит. Полезен
   *   один вопрос — что едет ко мне сейчас, и он же сверяется с кабинетом.
   *   Заодно это одна страница вместо двадцати двух.
   *
   * Мёртвые заявки (`stage === 'dead'`) не считаются НИГДЕ — ни за период, ни в
   * «Всего»: отменённый или отклонённый `CREATED` возвратом не стал, а лежать в
   * ответе может годами. Проверка стоит ДО дедупликации намеренно: иначе такая
   * запись заняла бы orderId и выбросила из отчёта живой возврат того же заказа.
   *
   * Один и тот же заказ приходит и сюда, и в список заказов с возвратным
   * подстатусом — считать его дважды нельзя. Дедупликация по orderId; кабинет
   * тоже считает заказами, а не записями (у одного заказа их бывает две).
   */
  private async collectReturns(
    client: YandexApiClient,
    alreadyCounted: IReportOrder[],
    period: IReportPeriod,
    now: Date,
  ): Promise<IReturnsSummary> {
    const seen = new Set(alreadyCounted.map((order) => order.id).filter((id) => id != null));
    const unbounded = isUnbounded(period);
    const bounds = unbounded ? null : periodBounds(period, now);

    let totals = ZERO_TOTALS;
    let count = 0;
    let inFlight = 0;
    let settled = 0;
    const records: IReturnRecord[] = [];

    const stages = unbounded ? RETURN_ACTIVE_STATUSES : RETURN_SHIPMENT_STATUSES;

    for await (const page of client.iterateReturns({ shipmentStatuses: [...stages] })) {
      for (const record of page) {
        if (bounds && !withinPeriod(bounds, record.creationDate)) continue;

        const stage = returnStage(record.shipmentStatus, record.refundStatus);
        if (stage === 'dead') continue;

        // Возврат, чей заказ уже посчитан по подстатусу, пропускаем целиком:
        // иначе один невыкуп попадёт в отчёт дважды — и штукой, и суммой.
        if (record.orderId != null && seen.has(record.orderId)) continue;
        if (record.orderId != null) seen.add(record.orderId);

        // У возврата нет разбивки на товары и доставку — сумма одна, и она
        // попадает в обе величины, иначе «с доставкой» окажется меньше товаров.
        const value = amountValue(record.amount);
        totals = addTotals(totals, { items: value, withDelivery: value });
        count += 1;
        records.push(record);

        if (stage === 'inFlight') inFlight += 1;
        if (stage === 'settled') settled += 1;
      }
    }

    return { count, totals, inFlight, settled, records };
  }

  /**
   * Выгрузка «едет до клиента» файлом.
   *
   * Пустой результат НЕ отправляет пустой файл: продавец, открывший книгу из
   * одной шапки, решит, что сломался бот, а не что заказов нет.
   */
  public async exportInTransit(
    store: YandexMarketDocument,
    now: Date = new Date(),
  ): Promise<IReportExport> {
    const result = await this.build(store, REPORT.IN_TRANSIT, now);

    if (!result.count) {
      return { empty: true, message: formatReport(result, now) };
    }

    const workbook = buildOrdersWorkbook(result.orders);

    // Про обрезку сообщаем прямо в подписи к файлу: молча урезанная выгрузка
    // выглядит как полная, и расхождение с личным кабинетом продавец найдёт
    // сам, в худший для этого момент.
    const truncated = workbook.truncated
      ? `\n\n⚠️ В файл попали первые ${workbook.rows} заказов из ${result.count}: остальные не поместились.`
      : '';

    return {
      empty: false,
      buffer: workbook.buffer,
      filename: workbookFileName(moscowDateParam(now), moscowClock(now)),
      caption: formatReport(result, now) + truncated,
    };
  }

  /**
   * Выгрузка «уехало клиенту» файлом: периодная, как exportReturning, книга
   * заказов — как exportInTransit. `options` нужны срезу «Всего»: под флагом
   * deep_history он идёт через архив.
   */
  public async exportShipped(
    store: YandexMarketDocument,
    period: IReportPeriod = DEFAULT_PERIOD,
    now: Date = new Date(),
    options: IReportBuildOptions = {},
  ): Promise<IReportExport> {
    const result = await this.build(store, REPORT.SHIPPED_TODAY, now, period, options);

    if (!result.count) {
      return { empty: true, message: formatReport(result, now) };
    }

    const workbook = buildOrdersWorkbook(result.orders);
    const truncated = workbook.truncated
      ? `\n\n⚠️ В файл попали первые ${workbook.rows} заказов из ${result.count}: остальные не поместились.`
      : '';

    return {
      empty: false,
      buffer: workbook.buffer,
      filename: shippedFileName(moscowDateParam(now), moscowClock(now)),
      caption: formatReport(result, now) + truncated,
    };
  }

  /**
   * Выгрузка «едет обратно» файлом: артикулы возвращаемых позиций в тексте
   * сообщения не помещаются. Подпись — тот же текст отчёта, что уходил без
   * файла; пустой результат, как и в exportInTransit, — текст без файла.
   */
  public async exportReturning(
    store: YandexMarketDocument,
    period: IReportPeriod = DEFAULT_PERIOD,
    now: Date = new Date(),
  ): Promise<IReportExport> {
    const result = await this.build(store, REPORT.RETURNING, now, period);

    if (!result.count) {
      return { empty: true, message: formatReport(result, now) };
    }

    const workbook = buildReturningWorkbook(result.orders, result.returns?.records ?? []);

    // «Строк», а не «заказов»: в этой книге строка — позиция, и один заказ
    // занимает их несколько.
    const truncated = workbook.truncated
      ? `\n\n⚠️ В файл попали первые ${workbook.rows} строк: остальные не поместились.`
      : '';

    return {
      empty: false,
      buffer: workbook.buffer,
      filename: returningFileName(moscowDateParam(now), moscowClock(now)),
      caption: formatReport(result, now) + truncated,
    };
  }

  /** Ключи отчётов — для клавиатуры и роутинга кнопок. */
  public static get keys(): TReportKey[] {
    return Object.values(REPORT);
  }
}
