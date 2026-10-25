import type { IFinanceOperationContext, IFinanceOperationRow } from './finance-journal';
import type { IFinancePeriod } from './finance-period';
import type { TFinanceImportAttempt, TFinanceReconcileState } from './finance-period-status';
import type { IReconcileOrders } from './finance-reconcile.service';
import type { IOperationBreakdownPart } from './operation-breakdown';
import type { IYmActServicesTotal } from './ym-act-breakdown';
import type { TFinanceDb, TFinanceTx } from '../../database/postgres/finance-db';
import type {
  TFinanceDocumentSource,
  TFinanceMarketplace,
} from '../../database/postgres/finance.schema';
import type { YandexApiClient } from '../yandex/yandex-api.client';
import type { TSleep } from '../yandex/yandex-retry';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { FINANCE_DB } from '../../database/postgres/finance-db';
import { FinanceActServicesRepository } from '../../database/postgres/repositories/finance-act-services.repository';
import { FinanceCorrectionRepository } from '../../database/postgres/repositories/finance-correction.repository';
import { FinanceDocumentRepository } from '../../database/postgres/repositories/finance-document.repository';
import { FinanceOperationRepository } from '../../database/postgres/repositories/finance-operation.repository';
import { FinancePeriodRepository } from '../../database/postgres/repositories/finance-period.repository';
import { YandexMarketService } from '../../database/services/yandex-market.service';
import { ErrorReporter } from '../errors/error-reporter.service';
import { pollReportFile } from '../yandex/report-poll';
import { unzipReportJson } from '../yandex/report-zip';
import { YandexRateLimitError } from '../yandex/yandex-api.errors';
import {
  unitedMarketplaceServicesGeneratePath,
  unitedNettingGeneratePath,
} from '../yandex/yandex-api.paths';
import { YandexClientFactory } from '../yandex/yandex-client.factory';
import { realSleep } from '../yandex/yandex-retry';

import { FinanceAnomalyService } from './finance-anomaly.service';
import { correctionSideOf, pairCorrections } from './finance-corrections';
import {
  assertFinancePeriod,
  FINANCE_REPORT_TYPE,
  financePeriodKey,
  YM_NETTING_REPORT_TYPE,
  financeToday,
  monthPeriod,
  requestRange,
} from './finance-period';
import { periodStatusOf } from './finance-period-status';
import { FinanceReconcileService } from './finance-reconcile.service';
import { kopecksToRub, toKopecks } from './kopecks';
import { ymActBreakdownOf, ymActDayOf, ymActServicesTotalOf } from './ym-act-breakdown';
import { isYmActSummaryRow } from './ym-articles';
import {
  journalKeys,
  matchExistingOperations,
  nettingRowToOperation,
  nettingRowsOf,
  operationKeyOf,
  parseYmDateTime,
} from './ym-journal';
import { parseYmNettingFile } from './ym-netting-file';
import { reportUnknownArticles, unknownArticleGroups } from './ym-unknown-articles';

// Константа живёт в finance-period.ts (лист): её берут и сервисы, которые сами
// нужны импорту, — импорт её отсюда замкнул бы файлы в цикл.
export { YM_NETTING_REPORT_TYPE } from './finance-period';

export interface IFinanceImportRequest {
  telegramUserId: string;
  period: IFinancePeriod;
}

interface IImportBase {
  period: IFinancePeriod;
}

/** Итог импорта периода — три исхода, у каждого свой смысл. */
export type TFinanceImportResult =
  /** Маркет ответил DONE без файла: за период данных нет. Версия не заводится. */
  | (IImportBase & { status: 'empty' })
  /** Тот же файл (sha256), что у импортированной версии: операции не трогались. */
  | (IImportBase & { status: 'unchanged'; documentVersion: number; rows: number })
  | (IImportBase & {
      status: 'imported';
      documentVersion: number;
      rows: number;
      inserted: number;
      matched: number;
      /** Живые операции периода, которых в новой версии нет. */
      superseded: number;
      changed: number;
      removed: number;
      /** Строк без статьи — о них уже ушёл алерт. */
      unknown: number;
    });

export interface IFinanceManualImportRequest extends IFinanceImportRequest {
  buffer: Buffer;
  /** Имя файла как у продавца — по расширению выбирается разбор, с ним же сохраняется оригинал. */
  filename: string;
}

/** Итог ручной загрузки: пустого исхода нет — файл без операций отвергает разбор. */
export type TFinanceManualImportResult =
  | (IImportBase & { status: 'unchanged'; documentVersion: number; rows: number })
  | (IImportBase & {
      status: 'imported';
      documentId: string;
      documentVersion: number;
      rows: number;
      inserted: number;
      matched: number;
      /** Строки, которые новая версия Маркета уже сняла: не оживляем. */
      skippedSuperseded: number;
      unknown: number;
    });

/**
 * united-netting/generate: лимит Маркета — 1 генерация в минуту на кабинет
 * («1 points per 1 minute … for businessId»). Ночной проход заказывает подряд
 * текущий и прошлый месяц (по понедельникам ещё позапрошлый), кнопка CRM — несколько
 * месяцев сразу; повторы клиента (1–2–4 с) минуту не пережидают. Поэтому на 420/429
 * этого метода — пауза больше минуты и ещё попытка. Generate данных не меняет,
 * повтор безвреден; очередь `finance-import` одна на concurrency 1 — ждёт только она.
 */
export const NETTING_GENERATE_ATTEMPTS = 3;
export const NETTING_GENERATE_PAUSE_MS = 65_000;

/** generate с ожиданием минутного лимита; остальные ошибки — как были (их повторил клиент). */
export async function generateWithMinuteLimit(
  generate: () => Promise<string>,
  sleep: TSleep = realSleep,
): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await generate();
    } catch (error) {
      if (!(error instanceof YandexRateLimitError) || attempt >= NETTING_GENERATE_ATTEMPTS) {
        throw error;
      }
      await sleep(NETTING_GENERATE_PAUSE_MS);
    }
  }
}

/** У продавца нет магазина с business_id — некуда отнести журнал. */
export class FinanceNoStoreError extends Error {
  constructor() {
    super('Магазин не подключён — журнал не к чему отнести.');
    this.name = 'FinanceNoStoreError';
  }
}

/** Тот же период сейчас загружается другим путём — версия занята. */
export class FinanceImportBusyError extends Error {
  constructor() {
    super('Этот месяц сейчас загружается — повторите через минуту.');
    this.name = 'FinanceImportBusyError';
  }
}

/**
 * Журнал площадки, уже полученный и разобранный до базы (TASK-131) — то, что
 * общий путь записи версии (`importBatchAndRecord`) получает от площадки. У ЯМ
 * свой путь: генерация отчёта, расшифровка актов и итоги актов живут в той же
 * транзакции, и переписывать его ради общего контракта значило бы трогать
 * числа, сверенные с кабинетом.
 */
export interface IFinanceJournalBatch {
  businessId: string;
  /** Байты версии: одинаковый ответ площадки — одинаковые байты (sha256 → `unchanged`). */
  original: { buffer: Buffer; filename: string; contentType: string };
  /** Строки журнала для версии; контекст — её id, номер и ключ периода. */
  toOperations(ctx: IFinanceOperationContext): IFinanceOperationRow[];
  /** Алерт о нераспознанном после фиксации; возвращает число строк без статьи. */
  reportUnknown(ops: readonly IFinanceOperationRow[]): Promise<number>;
  /** Обновлять артикул у уже записанных строк (Ozon: ключ закупа по каталогу). */
  refreshSku?: boolean;
  /**
   * Пустая выплата новой версии не стирает записанную (Ozon, TASK-184): метод
   * начислений выплат не несёт, `paidAt` проставляет раскладка выплат после
   * импорта — без флага каждая новая версия обнуляла бы её до следующей раскладки.
   */
  keepPayment?: boolean;
  /**
   * Заказы площадки для сверки (TASK-132, Ozon — отправления). Нет — сверки у
   * площадки нет, период «не проверен» (`RECONCILE_NOT_IMPLEMENTED`).
   */
  orders?: IReconcileOrders;
}

/**
 * Площадка не дала источник заказов (`IFinanceJournalBatch.orders`, сейчас —
 * WB): период честно «не проверен», а не «Проверено» молчанием.
 */
export const RECONCILE_NOT_IMPLEMENTED =
  'Сверка начислений этой площадки с заказами ещё не сделана';

/** Скоуп статуса периода: чей журнал и какого типа. */
interface IStatusScope {
  marketplace: TFinanceMarketplace;
  reportType: string;
}

const YM_SCOPE: IStatusScope = { marketplace: 'ym', reportType: YM_NETTING_REPORT_TYPE };

const CONTENT_TYPES: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
};

function contentTypeOf(filename: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase() ?? '';
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * Расшифровку сводной строки акта не удалось построить или она не сошлась
 * (TASK-155). Отдельный класс — отдельный ключ троттлинга алертов.
 */
export class YmActBreakdownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YmActBreakdownError';
  }
}

/** Место алерта — без id продавца и акта, довод `YM_UNKNOWN_ARTICLE_CONTEXT`. */
export const YM_ACT_BREAKDOWN_CONTEXT = 'finance:ym-act-breakdown';

/** Что дал отчёт услуг до транзакции (TASK-155, TASK-158) и что сказать после неё. */
interface IActBreakdowns {
  /** operationKey сводной строки → части. */
  parts: Map<string, IOperationBreakdownPart[]>;
  /** Итоги актов для сверки с журналом — пишутся в транзакции версии. */
  totals: IYmActServicesTotal[];
  /** Остатки, незнакомые листы, акты с несколькими сводными строками — в алерт. */
  issues: string[];
}

/** 23505 — нарушение уникальности; drizzle кладёт ошибку драйвера в `cause`. */
function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

/**
 * Импорт журнала ЯМ (united-netting) за период: generate (format=JSON) →
 * поллинг → ZIP → лист transaction_date → операции со статьями → upsert;
 * версия документа периода и корректировки.
 *
 * Креды — из Mongo по telegramUserId: токен не едет ни в payload очереди, ни в
 * аргументы. Скоуп отчёта — весь кабинет (`campaignIds` не шлём): журнал
 * бизнесовый, магазин — признак строки (`model`), как в diagnose-finance.
 *
 * Ошибки не глушатся: FAILED/таймаут Маркета — `ReportGenerationError` с
 * reportId и временами, сбой разбора или записи — откат транзакции и проброс.
 * Кто сообщает — решает вызывающий (процессор очереди — `@OnQueueFailed`).
 */
@Injectable()
export class FinanceImportService {
  private readonly logger = new Logger(FinanceImportService.name);

  /** Пауза перед повтором generate на минутном лимите; тесты подменяют. */
  sleep: TSleep = realSleep;

  // Правило max-params отключено осознанно: импорт — точка, где журнал, версия,
  // корректировки, статус, сверка, аномалии и итоги актов складываются в одну
  // транзакцию и один проход. Склейка зависимостей в «контекст» спрятала бы
  // ровно этот список, а не уменьшила его.
  // eslint-disable-next-line max-params
  constructor(
    private readonly stores: YandexMarketService,
    private readonly clients: YandexClientFactory,
    private readonly documents: FinanceDocumentRepository,
    private readonly operations: FinanceOperationRepository,
    private readonly corrections: FinanceCorrectionRepository,
    private readonly errors: ErrorReporter,
    @Inject(FINANCE_DB) private readonly db: TFinanceDb,
    private readonly periods: FinancePeriodRepository,
    private readonly reconciler: FinanceReconcileService,
    private readonly anomalies: FinanceAnomalyService,
    private readonly actServices: FinanceActServicesRepository,
  ) {}

  /**
   * Импорт периода плюс его статус (TASK-112) — путь очереди и скрипта.
   *
   * Статус пишется после КАЖДОЙ попытки, и сбой тоже: «когда грузили и чем
   * кончилось» без строки на сбой не ответить. Правило статуса — чистая
   * `periodStatusOf`, одна на все пути; ошибка импорта после записи статуса
   * пробрасывается как была (сообщает вызывающий — `@OnQueueFailed` или цикл
   * ночного прохода).
   */
  async importAndRecord(
    request: IFinanceImportRequest,
    now: Date = new Date(),
  ): Promise<TFinanceImportResult> {
    if (!request.telegramUserId) throw new Error('Импорт финансов без telegramUserId');
    assertFinancePeriod(request.period);

    let result: TFinanceImportResult;
    try {
      result = await this.importPeriod(request, now);
    } catch (error) {
      try {
        await this.recordStatus(
          request,
          { outcome: 'failed', error: (error as Error)?.message ?? String(error) },
          now,
        );
      } catch (statusError) {
        // Исходная ошибка важнее: статус не записался — скажем в лог, но
        // наружу уйдёт причина сбоя импорта, а не Postgres.
        this.logger.warn(`Статус периода не записан: ${(statusError as Error).message}`);
      }
      throw error;
    }

    const reconcile = result.status === 'empty' ? null : await this.reconcileSafely(request, now);
    await this.recordStatus(request, await this.attemptOf(request, result, reconcile), now);
    // После статуса: строка периода уже есть, и отметка «проверено детектором»
    // ляжет в неё. Пустой отчёт — журнала нет, судить не о чем.
    if (result.status !== 'empty') await this.detectAnomaliesSafely(request, now);
    return result;
  }

  /**
   * Импорт периода площадки, чей журнал уже получен до базы (TASK-131, Ozon),
   * плюс статус периода — путь очереди и скрипта, как `importAndRecord` у ЯМ.
   *
   * `load` ходит к площадке и разбирает ответ; бросил — статус «сбой» и
   * проброс (сообщает вызывающий), `null` — за период операций нет. Запись —
   * та же транзакция версии, что у ЯМ: версия, upsert, снятие выпавших,
   * корректировки. Сверка — та же `reconcile`, что у ЯМ, с заказами из
   * `batch.orders` (Ozon, TASK-132) и без актов; нет источника — период «не
   * проверен». Аномалии — правила ЯМ — не считаются.
   */
  async importBatchAndRecord(
    request: IFinanceImportRequest & { marketplace: TFinanceMarketplace },
    load: () => Promise<IFinanceJournalBatch | null>,
    now: Date = new Date(),
  ): Promise<TFinanceImportResult> {
    const { telegramUserId, period, marketplace } = request;
    if (!telegramUserId) throw new Error('Импорт финансов без telegramUserId');
    assertFinancePeriod(period);
    const scope: IStatusScope = { marketplace, reportType: FINANCE_REPORT_TYPE[marketplace] };

    let result: TFinanceImportResult;
    let batch: IFinanceJournalBatch | null = null;
    try {
      batch = await load();
      result = batch
        ? await this.writeBatch(request, scope, batch, now)
        : { status: 'empty', period };
    } catch (error) {
      try {
        await this.recordStatus(
          request,
          { outcome: 'failed', error: (error as Error)?.message ?? String(error) },
          now,
          scope,
        );
      } catch (statusError) {
        this.logger.warn(`Статус периода не записан: ${(statusError as Error).message}`);
      }
      throw error;
    }

    let reconcile: TFinanceReconcileState | null = null;
    if (result.status !== 'empty') {
      reconcile = batch?.orders
        ? await this.reconcileSafely(request, now, scope, batch.orders)
        : { state: 'unchecked', discrepancies: 0, reason: RECONCILE_NOT_IMPLEMENTED };
    }
    await this.recordStatus(
      request,
      await this.attemptOf(request, result, reconcile, scope),
      now,
      scope,
    );
    return result;
  }

  /** Журнал площадки → версия документа периода и операции, одной транзакцией. */
  private async writeBatch(
    request: IFinanceImportRequest,
    scope: IStatusScope,
    batch: IFinanceJournalBatch,
    now: Date,
  ): Promise<TFinanceImportResult> {
    const { telegramUserId, period } = request;
    const periodKey = financePeriodKey(scope.reportType, period);

    const outcome = await this.db.transaction(async (tx) => {
      const { document, created } = await this.documents.registerVersion(
        {
          marketplace: scope.marketplace,
          telegramUserId,
          businessId: batch.businessId,
          reportType: scope.reportType,
          periodFrom: period.from,
          periodTo: period.to,
          ...batch.original,
          source: 'api',
        },
        tx,
      );
      if (!created) return { document, created: false as const };

      const ops = batch.toOperations({
        telegramUserId,
        businessId: batch.businessId,
        documentId: document.id,
        documentVersion: document.version,
        periodKey,
      });
      const applied = await this.apply(tx, {
        telegramUserId,
        businessId: batch.businessId,
        periodKey,
        ops,
        documentId: document.id,
        documentVersion: document.version,
        marketplace: scope.marketplace,
        refreshSku: batch.refreshSku,
        keepPayment: batch.keepPayment,
        now,
      });
      await this.documents.markImported(telegramUserId, document.id, ops.length, tx);
      return { document, created: true as const, ops, applied };
    });

    if (!outcome.created) {
      return {
        status: 'unchanged',
        period,
        documentVersion: outcome.document.version,
        rows: outcome.document.rowCount ?? 0,
      };
    }

    // После фиксации: о нераспознанном сообщаем, только когда оно правда легло в журнал.
    const unknown = await batch.reportUnknown(outcome.ops);
    const { applied } = outcome;
    this.logger.log(
      `Журнал ${scope.marketplace} ${telegramUserId} ${period.from}…${period.to} ` +
        `v${outcome.document.version}: строк ${outcome.ops.length}, новых ${applied.inserted}, ` +
        `снято ${applied.superseded} (изменено ${applied.changed}, убрано ${applied.removed}), ` +
        `без статьи ${unknown}`,
    );
    return {
      status: 'imported',
      period,
      documentVersion: outcome.document.version,
      rows: outcome.ops.length,
      ...applied,
      unknown,
    };
  }

  /**
   * Сверка уже загруженного периода без запроса отчёта — `--reconcile-only`
   * скрипта: квоту генераций (100/ч) не тратит. Статус пишется как после
   * повтора того же файла (`unchanged`): данные журнала не менялись.
   */
  async reconcileAndRecord(
    request: IFinanceImportRequest,
    now: Date = new Date(),
  ): Promise<TFinanceReconcileState> {
    assertFinancePeriod(request.period);
    const reconcile = await this.reconcileSafely(request, now);
    await this.recordStatus(
      request,
      await this.attemptOf(
        request,
        { status: 'unchanged', period: request.period, documentVersion: 0, rows: 0 },
        reconcile,
      ),
      now,
    );
    await this.detectAnomaliesSafely(request, now);
    return reconcile;
  }

  /**
   * Аномалии месяца (TASK-149) — после сверки: её находки входят в список.
   * Сбой не роняет импорт и не трогает статус: журнал верен, а аномалии —
   * подсказка поверх него. Считаются для всех, кому идёт загрузка (только
   * база, Маркет не спрашивается); показ закрывает фича `finance_anomalies`.
   */
  private async detectAnomaliesSafely(request: IFinanceImportRequest, now: Date): Promise<void> {
    try {
      await this.anomalies.detectPeriod(request.telegramUserId, request.period, now);
    } catch (error) {
      void this.errors.report({
        error,
        telegramUserId: request.telegramUserId,
        source: 'queue',
        context: 'finance:anomalies',
      });
    }
  }

  /**
   * Сверка после удачной загрузки (TASK-113). Сбой сверки не роняет импорт:
   * журнал уже записан и верен, а «не смогли сверить» — состояние периода
   * (`failed` → не «Проверено»), не повод повторять генерацию отчёта.
   */
  private async reconcileSafely(
    request: IFinanceImportRequest,
    now: Date,
    scope: IStatusScope = YM_SCOPE,
    orders?: IReconcileOrders,
  ): Promise<TFinanceReconcileState> {
    const { telegramUserId, period } = request;
    try {
      return orders
        ? await this.reconciler.reconcileMarketplace(scope, telegramUserId, period, orders, {
            acts: false,
            now,
          })
        : await this.reconciler.reconcilePeriod(telegramUserId, period, now);
    } catch (error) {
      void this.errors.report({
        error,
        telegramUserId: request.telegramUserId,
        source: 'queue',
        context: 'finance:reconcile',
      });
      return { state: 'failed', error: (error as Error)?.message ?? String(error) };
    }
  }

  /** Итог импорта → попытка со счётчиками последней версии. */
  private async attemptOf(
    request: IFinanceImportRequest,
    result: TFinanceImportResult,
    reconcile: TFinanceReconcileState | null,
    scope: IStatusScope = YM_SCOPE,
  ): Promise<TFinanceImportAttempt> {
    if (result.status === 'empty' || !reconcile) return { outcome: 'empty' };
    if (result.status === 'imported') {
      return {
        outcome: 'imported',
        documentVersion: result.documentVersion,
        unknown: result.unknown,
        changed: result.changed,
        removed: result.removed,
        reconcile,
      };
    }
    // Тот же файл: импорт ничего не считал, счётчики версии читаются из базы —
    // а не берутся из прошлой строки статуса, которой могло и не быть (версию
    // загрузил скрипт до TASK-112).
    const document = await this.documents.latest({
      marketplace: scope.marketplace,
      telegramUserId: request.telegramUserId,
      reportType: scope.reportType,
      periodFrom: request.period.from,
      periodTo: request.period.to,
    });
    if (!document) throw new Error('У периода нет загруженной версии отчёта');
    const [unknown, corrections] = await Promise.all([
      this.operations.countUnknown(request.telegramUserId, document.id),
      this.corrections.countByDocument(request.telegramUserId, document.id),
    ]);
    return {
      outcome: 'unchanged',
      documentVersion: document.version,
      unknown,
      ...corrections,
      reconcile,
    };
  }

  private async recordStatus(
    request: IFinanceImportRequest,
    attempt: TFinanceImportAttempt,
    now: Date,
    scope: IStatusScope = YM_SCOPE,
  ): Promise<void> {
    const { telegramUserId, period } = request;
    const key = {
      marketplace: scope.marketplace,
      telegramUserId,
      periodKey: financePeriodKey(scope.reportType, period),
    };
    const previous = await this.periods.find(key);
    const state = periodStatusOf({
      periodTo: period.to,
      today: financeToday(now),
      attempt,
      previous,
    });
    await this.periods.upsert({
      ...key,
      reportType: scope.reportType,
      periodFrom: period.from,
      periodTo: period.to,
      ...state,
      checkedAt: now,
    });
  }

  async importPeriod(
    request: IFinanceImportRequest,
    now: Date = new Date(),
  ): Promise<TFinanceImportResult> {
    const { telegramUserId, period } = request;
    if (!telegramUserId) throw new Error('Импорт финансов без telegramUserId');
    assertFinancePeriod(period);

    const store = await this.stores.findByTelegramUser(telegramUserId);
    if (!store?.business_id) {
      throw new Error(`Импорт финансов: у продавца ${telegramUserId} не подключён магазин`);
    }
    const client = this.clients.forStore(store);

    // Незакрытый месяц запрашивается по сегодня, но хранится целым месяцем —
    // см. requestRange.
    const range = requestRange(period, financeToday(now));
    const reportId = await generateWithMinuteLimit(
      () =>
        client.generateReport(
          unitedNettingGeneratePath(),
          { businessId: Number(store.business_id), dateFrom: range.from, dateTo: range.to },
          'JSON',
        ),
      this.sleep,
    );
    const fileUrl = await pollReportFile(client, reportId, {
      intervalMs: 5000,
      maxAttempts: 120,
      failedError: 'Финансовый отчёт united-netting не сгенерировался',
      notReadyError: 'Финансовый отчёт united-netting не готов за 10 минут',
    });
    if (!fileUrl) return { status: 'empty', period };

    const buffer = await client.downloadReportFile(fileUrl);
    // Разбор — до транзакции: ZIP и строки не трогают базу, и неизвестная
    // форма отчёта падает, не открыв ни одного соединения.
    const rows = nettingRowsOf(unzipReportJson(buffer));
    const keys = journalKeys(rows);
    // Тоже до транзакции: отчёт услуг — минуты Маркета, транзакция их не ждёт.
    const breakdowns = await this.actBreakdowns({
      client,
      telegramUserId,
      businessId: Number(store.business_id),
      rows,
      keys,
      today: financeToday(now),
    });
    const outcome = await this.importRows({
      telegramUserId,
      businessId: String(store.business_id),
      period,
      rows,
      keys,
      breakdowns: breakdowns.parts,
      actTotals: breakdowns.totals,
      original: {
        buffer,
        filename: `united-netting-${period.from}-${period.to}.zip`,
        contentType: 'application/zip',
      },
      source: 'api',
      now,
    });

    // После фиксации, как алерт незнакомых статей: о расшифровке сообщаем,
    // только когда она правда легла (или не легла) в журнал.
    await this.reportActBreakdownIssues(breakdowns.issues, telegramUserId);

    if (!outcome.created) {
      return {
        status: 'unchanged',
        period,
        documentVersion: outcome.document.version,
        rows: outcome.document.rowCount ?? 0,
      };
    }

    // Алерт — после фиксации: о незнакомых статьях сообщаем, только когда они
    // правда легли в журнал.
    const { ops, applied } = outcome;
    await reportUnknownArticles(this.errors, ops, telegramUserId);
    const unknown = unknownArticleGroups(ops).reduce((sum, g) => sum + g.count, 0);

    this.logger.log(
      `Журнал ЯМ ${telegramUserId} ${period.from}…${period.to} v${outcome.document.version}: ` +
        `строк ${ops.length}, новых ${applied.inserted}, снято ${applied.superseded} ` +
        `(изменено ${applied.changed}, убрано ${applied.removed}), без статьи ${unknown}`,
    );

    return {
      status: 'imported',
      period,
      documentVersion: outcome.document.version,
      rows: ops.length,
      ...applied,
      unknown,
    };
  }

  /**
   * Отчёт услуг united-marketplace-services под акты этого журнала — для двух
   * вещей сразу, ОДНОЙ генерацией на акт (квота 100/ч):
   * - расшифровка сводной строки акта (TASK-155) — только под акт, у сводной
   *   строки которого расшифровки ещё нет;
   * - итог акта для сверки с журналом (TASK-158) — под закрытый акт, итога
   *   которого нет или последняя сверка нашла расхождение. Второе —
   *   самоизлечение: отчёт услуг, взятый раньше, чем Маркет дописал акт,
   *   перезапрашивается. Итог есть и не опровергнут — квота не тратится.
   *
   * Отчёт за месяц M несёт только акт M, а журнал за M — ещё и строки акта
   * M−1, поэтому отчёт заказывается за месяц АКТА.
   *
   * Не бросает. Отчёт услуг не загрузился — `ErrorReporter`, сводная строка
   * остаётся `other_services` целиком, итога нет (сверка скажет «не
   * проверено»), повтор — следующим импортом (даже тем же файлом). Импорт
   * журнала из-за этого не падает: операции важнее расшифровки и сверки.
   */
  private async actBreakdowns(input: {
    client: YandexApiClient;
    telegramUserId: string;
    businessId: number;
    rows: readonly Record<string, unknown>[];
    keys: readonly string[];
    today: string;
  }): Promise<IActBreakdowns> {
    const result: IActBreakdowns = { parts: new Map(), totals: [], issues: [] };
    const byAct = await this.summariesToBreakdown(input, result.issues);
    const needTotal = await this.actsToTotal(input);

    const days = [...new Set([...byAct.keys(), ...needTotal])].sort();
    for (const day of days) {
      let sheets: ReadonlyMap<string, unknown> | null;
      try {
        sheets = await this.servicesSheets(input.client, input.businessId, day, input.today);
      } catch (error) {
        void this.errors.report({
          error,
          telegramUserId: input.telegramUserId,
          source: 'queue',
          context: YM_ACT_BREAKDOWN_CONTEXT,
        });
        continue;
      }
      if (needTotal.has(day)) {
        const total = sheets ? ymActServicesTotalOf(day, sheets) : null;
        if (total) result.totals.push(total);
      }
      const group = byAct.get(day);
      if (group) this.breakdownOne(day, group, sheets, result);
    }
    return result;
  }

  /** Сводные строки без расшифровки по дню акта; две строки одного акта — в issues. */
  private async summariesToBreakdown(
    input: {
      telegramUserId: string;
      rows: readonly Record<string, unknown>[];
      keys: readonly string[];
    },
    issues: string[],
  ): Promise<Map<string, { row: Record<string, unknown>; key: string }>> {
    const byAct = new Map<string, { row: Record<string, unknown>; key: string }>();
    const summaries = input.rows
      .map((row, i) => ({ row, key: operationKeyOf(input.keys[i]) }))
      .filter(({ row }) => isYmActSummaryRow(row));
    if (!summaries.length) return byAct;

    const known = await this.operations.breakdownsByKeys(
      input.telegramUserId,
      summaries.map((s) => s.key),
    );
    const groups = new Map<string, typeof summaries>();
    for (const summary of summaries) {
      if (known.has(summary.key)) continue;
      const day = ymActDayOf(summary.row.actDate);
      if (!day) {
        issues.push(`сводная строка без даты акта (${String(summary.row.actDate)})`);
        continue;
      }
      groups.set(day, [...(groups.get(day) ?? []), summary]);
    }
    for (const [day, group] of groups) {
      // Отчёт услуг делится по акту, а не по строке журнала: две сводные строки
      // одного акта по нему не разделить — угадывать долю значило бы подогнать.
      if (group.length > 1) {
        issues.push(`акт ${day}: сводных строк ${group.length}, расшифровка не делится`);
        continue;
      }
      byAct.set(day, group[0]);
    }
    return byAct;
  }

  /**
   * Закрытые акты отчёта, которым нужен итог услуг (TASK-158): итога нет или
   * последняя сверка нашла, что он не сходится с журналом. С журналом здесь не
   * сравниваем: строки акта лежат в отчётах двух месяцев, и сравнение с одним
   * отчётом перезаказывало бы отчёт услуг каждую ночь.
   */
  private async actsToTotal(input: {
    telegramUserId: string;
    rows: readonly Record<string, unknown>[];
    today: string;
  }): Promise<Set<string>> {
    const days = new Set<string>();
    for (const row of input.rows) {
      const day = ymActDayOf(row.actDate);
      if (day && day < input.today) days.add(day);
    }
    if (!days.size) return days;
    const stored = await this.actServices.byDays(input.telegramUserId, [...days]);
    return new Set(
      [...days].filter((day) => {
        const known = stored.get(day);
        return !known || known.journalMatched === false;
      }),
    );
  }

  /** Расшифровка одной сводной строки по листам её акта. */
  private breakdownOne(
    day: string,
    { row, key }: { row: Record<string, unknown>; key: string },
    sheets: ReadonlyMap<string, unknown> | null,
    result: IActBreakdowns,
  ): void {
    const kopecks = toKopecks(row.transactionSum);
    const breakdown = sheets && kopecks !== null ? ymActBreakdownOf(kopecks, day, sheets) : null;
    if (!breakdown) {
      result.issues.push(`акт ${day}: в отчёте услуг нет строк этого акта`);
      return;
    }
    result.parts.set(key, breakdown.parts);
    if (breakdown.remainderKopecks !== 0) {
      result.issues.push(
        `акт ${day}: не сошлось на ${kopecksToRub(breakdown.remainderKopecks)} ₽ — ` +
          'остаток записан статьёй «не распознано»',
      );
    }
    if (breakdown.unknownSheets.length) {
      result.issues.push(`акт ${day}: листы без правила — ${breakdown.unknownSheets.join(', ')}`);
    }
  }

  /** Листы отчёта услуг за месяц акта; DONE без файла — null. */
  private async servicesSheets(
    client: YandexApiClient,
    businessId: number,
    actDay: string,
    today: string,
  ): Promise<ReadonlyMap<string, unknown> | null> {
    const range = requestRange(
      monthPeriod(Number(actDay.slice(0, 4)), Number(actDay.slice(5, 7))),
      today,
    );
    const reportId = await client.generateReport(
      unitedMarketplaceServicesGeneratePath(),
      { businessId, dateFrom: range.from, dateTo: range.to },
      'JSON',
    );
    const fileUrl = await pollReportFile(client, reportId, {
      intervalMs: 5000,
      maxAttempts: 120,
      failedError: 'Отчёт united-marketplace-services не сгенерировался',
      notReadyError: 'Отчёт united-marketplace-services не готов за 10 минут',
    });
    if (!fileUrl) return null;
    return unzipReportJson(await client.downloadReportFile(fileUrl));
  }

  /** Один алерт на загрузку, сколько бы актов ни не сошлось. */
  private async reportActBreakdownIssues(issues: string[], telegramUserId: string): Promise<void> {
    if (!issues.length) return;
    await this.errors.report({
      error: new YmActBreakdownError(
        `Журнал ЯМ: сводная строка акта не расшифрована — проверьте ym-act-breakdown.ts\n${issues.join('\n')}`,
      ),
      source: 'queue',
      context: YM_ACT_BREAKDOWN_CONTEXT,
      telegramUserId,
    });
  }

  /**
   * Ручная загрузка файла united-netting из кабинета (TASK-114, CRM).
   *
   * Тот же путь, что у импорта: строки → `nettingRowToOperation` (классификатор)
   * → upsert по ключу операции → версия документа периода с оригиналом. Отличия
   * — ровно два, и оба — решения владельца:
   * - ручная версия ТОЛЬКО добавляет и обновляет (`finance_upload_append_only`):
   *   кусок месяца не должен выбить из P&L операции, пришедшие через API. Строка,
   *   которую новая версия Маркета уже сняла, тоже не оживает — её пропускаем;
   * - ключ строки, у которой уже есть операция с тем же каноническим видом,
   *   берётся у неё (`matchExistingOperations`): типы значений в файле кабинета
   *   и в JSON Маркета могут не совпасть, а дубль в журнале — удвоенная статья.
   *
   * Сверка, статус и аномалии периода идут следом в `followUp` — сверка ходит в
   * Маркет, и ждать её в HTTP-запросе незачем. `followUp` не бросает.
   */
  async importManual(
    request: IFinanceManualImportRequest,
    now: Date = new Date(),
  ): Promise<{ result: TFinanceManualImportResult; followUp: Promise<void> }> {
    const { telegramUserId, period, buffer, filename } = request;
    if (!telegramUserId) throw new Error('Ручная загрузка финансов без telegramUserId');
    assertFinancePeriod(period);

    const store = await this.stores.findByTelegramUser(telegramUserId);
    if (!store?.business_id) throw new FinanceNoStoreError();

    // Разбор — до базы: нераспознанный файл не открывает ни одного соединения.
    const { rows } = parseYmNettingFile(buffer, filename);
    const moments = rows.map((row) => parseYmDateTime(row.transactionDate)?.getTime() ?? NaN);
    const existing = await this.operations.existingBetween(
      telegramUserId,
      new Date(Math.min(...moments)),
      new Date(Math.max(...moments)),
    );
    const matches = matchExistingOperations(rows, existing);
    const journal = journalKeys(rows);

    const kept: { row: Record<string, unknown>; key: string; operationKey?: string }[] = [];
    let skippedSuperseded = 0;
    rows.forEach((row, i) => {
      const match = matches[i];
      if (match?.superseded) skippedSuperseded += 1;
      else kept.push({ row, key: journal[i], operationKey: match?.operationKey });
    });

    let outcome: Awaited<ReturnType<FinanceImportService['importRows']>>;
    try {
      outcome = await this.importRows({
        telegramUserId,
        businessId: String(store.business_id),
        period,
        rows: kept.map((k) => k.row),
        keys: kept.map((k) => k.key),
        operationKeys: kept.map((k) => k.operationKey),
        original: { buffer, filename, contentType: contentTypeOf(filename) },
        source: 'manual',
        now,
      });
    } catch (error) {
      // Номер версии периода занят параллельной загрузкой (ночной импорт или
      // вторая вкладка) — уникальный индекс finance_documents_period_version_uq.
      if (isUniqueViolation(error)) throw new FinanceImportBusyError();
      throw error;
    }

    let result: TFinanceManualImportResult;
    if (!outcome.created) {
      result = {
        status: 'unchanged',
        period,
        documentVersion: outcome.document.version,
        rows: outcome.document.rowCount ?? 0,
      };
    } else {
      const { ops, applied } = outcome;
      await reportUnknownArticles(this.errors, ops, telegramUserId);
      result = {
        status: 'imported',
        period,
        documentId: outcome.document.id,
        documentVersion: outcome.document.version,
        rows: rows.length,
        inserted: applied.inserted,
        matched: applied.matched,
        skippedSuperseded,
        unknown: unknownArticleGroups(ops).reduce((sum, g) => sum + g.count, 0),
      };
      this.logger.log(
        `Журнал ЯМ вручную ${telegramUserId} ${period.from}…${period.to} v${result.documentVersion}: ` +
          `строк ${rows.length}, новых ${applied.inserted}, уже было ${applied.matched}, ` +
          `снятых пропущено ${skippedSuperseded}`,
      );
    }

    const followUp = this.recordManualFollowUp({ telegramUserId, period }, result, now);
    return { result, followUp };
  }

  /** Сверка, статус и аномалии после ручной загрузки — как после импорта; не бросает. */
  private async recordManualFollowUp(
    request: IFinanceImportRequest,
    result: TFinanceManualImportResult,
    now: Date,
  ): Promise<void> {
    try {
      const asImport: TFinanceImportResult =
        result.status === 'imported'
          ? {
              status: 'imported',
              period: result.period,
              documentVersion: result.documentVersion,
              rows: result.rows,
              inserted: result.inserted,
              matched: result.matched,
              superseded: 0,
              changed: 0,
              removed: 0,
              unknown: result.unknown,
            }
          : result;
      const reconcile = await this.reconcileSafely(request, now);
      await this.recordStatus(request, await this.attemptOf(request, asImport, reconcile), now);
      await this.detectAnomaliesSafely(request, now);
    } catch (error) {
      void this.errors.report({
        error,
        telegramUserId: request.telegramUserId,
        source: 'crm',
        context: 'finance:manual-upload',
      });
    }
  }

  /**
   * Готовые строки журнала → версия документа периода и операции. ОДНА
   * транзакция (ради неё финансы и в Postgres, решение finance_postgres):
   * регистрация версии, upsert, для API — снятие выпавших и корректировки,
   * отметка «imported». Сбой посередине откатывает всё — периода «наполовину
   * старой версии» не бывает, а повтор начинает с нуля.
   *
   * `source: 'manual'` — только добавление (`finance_upload_append_only`): без
   * снятия выпавших, и пустая выплата из файла не стирает записанную.
   */
  private async importRows(input: {
    telegramUserId: string;
    businessId: string;
    period: IFinancePeriod;
    rows: readonly Record<string, unknown>[];
    keys: readonly string[];
    /** Ключ уже записанной операции для строки — вместо ключа из `keys`. */
    operationKeys?: readonly (string | undefined)[];
    /** Расшифровки сводных строк акта по operationKey (TASK-155). */
    breakdowns?: ReadonlyMap<string, IOperationBreakdownPart[]>;
    /** Итоги актов из отчёта услуг (TASK-158) — в той же транзакции. */
    actTotals?: readonly IYmActServicesTotal[];
    original: { buffer: Buffer; filename: string; contentType: string };
    source: TFinanceDocumentSource;
    now: Date;
  }) {
    const { telegramUserId, businessId, period, rows, keys, source } = input;
    const periodKey = financePeriodKey(YM_NETTING_REPORT_TYPE, period);

    return await this.db.transaction(async (tx) => {
      const { document, created } = await this.documents.registerVersion(
        {
          marketplace: 'ym',
          telegramUserId,
          businessId,
          reportType: YM_NETTING_REPORT_TYPE,
          periodFrom: period.from,
          periodTo: period.to,
          ...input.original,
          source,
        },
        tx,
      );
      // Тот же файл уже разобран: версия существует только после успешной
      // транзакции, так что «не импортированной» её не бывает. Расшифровку,
      // которой в прошлый раз не было (отчёт услуг не загрузился), — дописать.
      if (input.actTotals?.length) {
        await this.actServices.upsertMany(telegramUserId, input.actTotals, input.now, tx);
      }
      if (!created) {
        if (input.breakdowns?.size) {
          await this.operations.setBreakdowns(telegramUserId, input.breakdowns, tx);
        }
        return { document, created: false as const };
      }

      const ops = rows.map((row, i) => {
        const op = nettingRowToOperation(row, keys[i], {
          telegramUserId,
          businessId,
          documentId: document.id,
          documentVersion: document.version,
          periodKey,
        });
        const reuse = input.operationKeys?.[i];
        const keyed = reuse ? { ...op, operationKey: reuse } : op;
        const breakdown = input.breakdowns?.get(keyed.operationKey);
        return breakdown ? { ...keyed, breakdown } : keyed;
      });
      const applied = await this.apply(tx, {
        telegramUserId,
        businessId,
        periodKey,
        ops,
        documentId: document.id,
        documentVersion: document.version,
        appendOnly: source === 'manual',
        now: input.now,
      });
      await this.documents.markImported(telegramUserId, document.id, ops.length, tx);
      return { document, created: true as const, ops, applied };
    });
  }

  /** Операции версии → журнал: upsert, снятие выпавших строк, корректировки. Внутри транзакции. */
  private async apply(
    tx: TFinanceTx,
    input: {
      telegramUserId: string;
      businessId: string;
      periodKey: string;
      ops: IFinanceOperationRow[];
      documentId: string;
      documentVersion: number;
      /** Ручная версия: только upsert, без снятия выпавших и корректировок. */
      appendOnly?: boolean;
      /** Чей журнал; по умолчанию ЯМ. */
      marketplace?: TFinanceMarketplace;
      refreshSku?: boolean;
      keepPayment?: boolean;
      now: Date;
    },
  ) {
    const { telegramUserId, businessId, periodKey, ops, documentId, documentVersion } = input;
    const marketplace = input.marketplace ?? 'ym';

    if (input.appendOnly) {
      const { inserted, matched } = await this.operations.upsertMany(ops, tx, {
        keepPayment: true,
      });
      return { inserted, matched, superseded: 0, changed: 0, removed: 0 };
    }

    // Ключи периода ДО записи — чтобы отличить новые строки от бывших. У первой
    // версии сравнивать не с чем: корректировок у неё не бывает.
    const before =
      documentVersion > 1
        ? await this.operations.keysOfPeriod(telegramUserId, periodKey, tx, marketplace)
        : new Set<string>();

    const { inserted, matched } = await this.operations.upsertMany(ops, tx, {
      refreshSku: input.refreshSku,
      keepPayment: input.keepPayment,
    });

    const stale = await this.operations.findStale(
      telegramUserId,
      periodKey,
      documentId,
      tx,
      marketplace,
    );
    let changed = 0;
    if (stale.length) {
      const added = ops.filter((op) => !before.has(op.operationKey)).map(correctionSideOf);
      const pairs = pairCorrections(stale, added);
      await this.operations.markSuperseded(
        telegramUserId,
        stale.map((s) => s.operationKey),
        documentVersion,
        input.now,
        tx,
        marketplace,
      );
      await this.corrections.record(
        { marketplace, telegramUserId, businessId, periodKey, documentId, documentVersion },
        pairs,
        tx,
      );
      changed = pairs.filter((p) => p.kind === 'changed').length;
    }

    return {
      inserted,
      matched,
      superseded: stale.length,
      changed,
      removed: stale.length - changed,
    };
  }
}
