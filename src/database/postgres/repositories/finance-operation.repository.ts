import type { IPaidOperation, IReceivableRow } from '../../../modules/finance/cashflow';
import type { IFinanceCorrectionSide } from '../../../modules/finance/finance-corrections';
import type { IFinanceOperationRow } from '../../../modules/finance/finance-journal';
import type {
  IReconcileActJournal,
  IReconcileOperation,
} from '../../../modules/finance/finance-reconcile';
import type { IFinanceScreenOperation } from '../../../modules/finance/finance-screen';
import type { IOperationBreakdownPart } from '../../../modules/finance/operation-breakdown';
import type { IPnlOperation } from '../../../modules/finance/pnl';
import type { TFinanceDb, TFinanceExecutor } from '../finance-db';
import type { TFinanceMarketplace } from '../finance.schema';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, count, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, sql } from 'drizzle-orm';

import { FINANCE_ARTICLE_KEYS } from '../../../modules/finance/finance-articles';
import { correctionSideOf } from '../../../modules/finance/finance-corrections';
import { shiftDay } from '../../../modules/finance/finance-period';
import { MAX_FINDING_OPERATION_REFS } from '../../../modules/finance/finance-reconcile';
import { breakdownOf, expandBreakdown } from '../../../modules/finance/operation-breakdown';
import { TAX_BASE_ARTICLES } from '../../../modules/finance/tax';
import { FINANCE_DB } from '../finance-db';
import { financeOperations } from '../finance.schema';

/**
 * Сколько операций в одном INSERT. У Postgres потолок — 65 535 параметров на
 * запрос; строка операции — ~30 колонок, тысяча строк — ~30 тыс. параметров.
 */
const UPSERT_CHUNK_SIZE = 1000;

/**
 * Штуки строки для себестоимости, строкой — как их разбирает `countOf`. У ЯМ —
 * колонка `count` отчёта; у Ozon колонки нет, позиция операции — штука
 * (`items[]`, по позиции на единицу — на живом ответе не сверено, known-gaps).
 * У WB — колонка `quantity` строки отчёта реализации.
 * Выражение ЯМ не тронуто: его числа сверены с кабинетом.
 */
const COUNT_OF: Record<TFinanceMarketplace, ReturnType<typeof sql<string | null>>> = {
  ym: sql<string | null>`${financeOperations.raw}->>'count'`,
  ozon: sql<
    string | null
  >`CASE WHEN jsonb_typeof(${financeOperations.raw}->'items') = 'array' THEN jsonb_array_length(${financeOperations.raw}->'items')::text END`,
  wb: sql<string | null>`${financeOperations.raw}->>'quantity'`,
};

/** День акта по Москве — `act_date` хранится полуночью МСК (parseYmDate). */
const ACT_DAY = sql<string>`to_char(${financeOperations.actDate} AT TIME ZONE 'Europe/Moscow', 'YYYY-MM-DD')`;

export interface IFinanceUpsertResult {
  /** Новых операций. */
  inserted: number;
  /** Уже бывших — им обновлены только изменяемые поля. */
  matched: number;
}

const t = financeOperations;

/** Изменяемое при повторной встрече строки — всё остальное пишется только вставкой. */
const MUTABLE_ON_CONFLICT = {
  article: sql`excluded.article`,
  paymentStatus: sql`excluded.payment_status`,
  paidAt: sql`excluded.paid_at`,
  bankOrderId: sql`excluded.bank_order_id`,
  bankSumKopecks: sql`excluded.bank_sum_kopecks`,
  periodKey: sql`excluded.period_key`,
  lastDocumentId: sql`excluded.last_document_id`,
  lastDocumentVersion: sql`excluded.last_document_version`,
  // Строка снова в отчёте — живая, даже если прошлая версия её снимала.
  supersededAt: sql`NULL`,
  supersededByVersion: sql`NULL`,
  // Расшифровка сводной строки (TASK-155): пустая не стирает записанную — её
  // не несут ручная загрузка и импорт, у которого отчёт услуг не загрузился.
  breakdown: sql`COALESCE(excluded.breakdown, ${t.breakdown})`,
  updatedAt: sql`now()`,
};

/**
 * Ручная загрузка (TASK-114): выплату файл может не нести вовсе — колонок
 * поручения в выгрузке кабинета нет или они пусты. Пустое из файла не стирает
 * выплату, которую уже записал импорт Маркета: выплата не отменяется.
 */
const MUTABLE_ON_CONFLICT_KEEP_PAYMENT = {
  ...MUTABLE_ON_CONFLICT,
  paymentStatus: sql`COALESCE(excluded.payment_status, ${t.paymentStatus})`,
  paidAt: sql`COALESCE(excluded.paid_at, ${t.paidAt})`,
  bankOrderId: sql`COALESCE(excluded.bank_order_id, ${t.bankOrderId})`,
  bankSumKopecks: sql`COALESCE(excluded.bank_sum_kopecks, ${t.bankSumKopecks})`,
};

/**
 * Что обновляет повторная встреча строки. `refreshSku` — у Ozon (TASK-131):
 * артикул там — ключ закупа, найденный по каталогу при импорте, и каталог мог
 * не ответить в прошлый раз. Без обновления сырой SKU Ozon застрял бы в
 * строке навсегда — артикул пишется только вставкой. ЯМ его не передаёт:
 * `shopSku` у него приходит из отчёта и не меняется.
 */
function setOnConflict(options: { keepPayment?: boolean; refreshSku?: boolean }) {
  const base = options.keepPayment ? MUTABLE_ON_CONFLICT_KEEP_PAYMENT : MUTABLE_ON_CONFLICT;
  return options.refreshSku ? { ...base, sku: sql`excluded.sku` } : base;
}

/** Операция для сопоставления строк ручного файла с уже записанными (TASK-114). */
export interface IFinanceExistingOperation {
  operationKey: string;
  raw: Record<string, unknown>;
  superseded: boolean;
}

/**
 * Финансовые операции площадок (Postgres). Скоуп — telegramUserId в каждом
 * условии. Последний аргумент методов — база или открытая транзакция.
 */
@Injectable()
export class FinanceOperationRepository {
  private readonly logger = new Logger(FinanceOperationRepository.name);

  constructor(@Inject(FINANCE_DB) private readonly db: TFinanceDb) {}

  /**
   * Записать операции идемпотентно: повторная загрузка того же отчёта даёт
   * `inserted: 0`, а не дубли.
   *
   * `INSERT … ON CONFLICT (marketplace, telegram_user_id, operation_key) DO
   * UPDATE` — настоящий upsert по уникальному индексу, гонку двух загрузок
   * решает база. Неизменяемое (сумма, дата, raw, первая версия) пишется только
   * вставкой: иначе повтор перетёр бы `document_id` первой версии и сырую
   * строку. Изменяемое (выплата, статья, где видели последней) — обновляется:
   * дописанная Маркетом выплата иначе не дошла бы до базы никогда.
   *
   * Вставлена строка или обновлена — `xmax = 0` у возвращённой строки: у только
   * что вставленной версии строки xmax пуст.
   */
  async upsertMany(
    rows: readonly IFinanceOperationRow[],
    executor: TFinanceExecutor = this.db,
    options: { keepPayment?: boolean; refreshSku?: boolean } = {},
  ): Promise<IFinanceUpsertResult> {
    const result: IFinanceUpsertResult = { inserted: 0, matched: 0 };
    if (!rows.length) return result;

    for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
      const values = rows.slice(i, i + UPSERT_CHUNK_SIZE).map((row) => ({
        ...row,
        lastDocumentId: row.documentId,
        lastDocumentVersion: row.documentVersion,
      }));
      const written = await executor
        .insert(t)
        .values(values)
        .onConflictDoUpdate({
          target: [t.marketplace, t.telegramUserId, t.operationKey],
          set: setOnConflict(options),
        })
        .returning({ inserted: sql<boolean>`(xmax = 0)` });
      for (const { inserted } of written) {
        if (inserted) result.inserted += 1;
        else result.matched += 1;
      }
    }

    this.logger.log(
      `Финансовые операции ${rows[0].telegramUserId}: новых ${result.inserted}, уже было ${result.matched}`,
    );
    return result;
  }

  /** Ключи живых операций периода — до записи новой версии, чтобы отличить новые строки. */
  async keysOfPeriod(
    telegramUserId: string,
    periodKey: string,
    executor: TFinanceExecutor = this.db,
    marketplace: TFinanceMarketplace = 'ym',
  ): Promise<Set<string>> {
    const found = await executor
      .select({ operationKey: t.operationKey })
      .from(t)
      .where(
        and(
          eq(t.marketplace, marketplace),
          eq(t.telegramUserId, telegramUserId),
          eq(t.periodKey, periodKey),
          isNull(t.supersededAt),
        ),
      );
    return new Set(found.map((r) => r.operationKey));
  }

  /**
   * Живые операции периода, которых нет в версии `documentId`: upsert новой
   * версии переписал `last_document_id` всем строкам, что в ней есть.
   */
  async findStale(
    telegramUserId: string,
    periodKey: string,
    documentId: string,
    executor: TFinanceExecutor = this.db,
    marketplace: TFinanceMarketplace = 'ym',
  ): Promise<IFinanceCorrectionSide[]> {
    const found = await executor
      .select({
        operationKey: t.operationKey,
        amountKopecks: t.amountKopecks,
        accruedAt: t.accruedAt,
        article: t.article,
        transactionType: t.transactionType,
        transactionSource: t.transactionSource,
        serviceName: t.serviceName,
        orderId: t.orderId,
        sku: t.sku,
        actId: t.actId,
      })
      .from(t)
      .where(
        and(
          eq(t.marketplace, marketplace),
          eq(t.telegramUserId, telegramUserId),
          eq(t.periodKey, periodKey),
          ne(t.lastDocumentId, documentId),
          isNull(t.supersededAt),
        ),
      );
    // null из колонки → undefined стороны: корректировка не несёт пустых полей.
    return found.map((r) =>
      correctionSideOf({
        ...r,
        transactionSource: r.transactionSource ?? undefined,
        serviceName: r.serviceName ?? undefined,
        orderId: r.orderId ?? undefined,
        sku: r.sku ?? undefined,
        actId: r.actId ?? undefined,
      }),
    );
  }

  /** Пометить снятыми — не удалять: по ним разбирают корректировки. */
  async markSuperseded(
    telegramUserId: string,
    operationKeys: readonly string[],
    version: number,
    at: Date = new Date(),
    executor: TFinanceExecutor = this.db,
    marketplace: TFinanceMarketplace = 'ym',
  ): Promise<number> {
    let modified = 0;
    for (let i = 0; i < operationKeys.length; i += UPSERT_CHUNK_SIZE) {
      const updated = await executor
        .update(t)
        .set({ supersededAt: at, supersededByVersion: version, updatedAt: at })
        .where(
          and(
            eq(t.marketplace, marketplace),
            eq(t.telegramUserId, telegramUserId),
            inArray(t.operationKey, operationKeys.slice(i, i + UPSERT_CHUNK_SIZE) as string[]),
          ),
        )
        .returning({ id: t.id });
      modified += updated.length;
    }
    return modified;
  }

  /**
   * Живые строки версии без статьи — счётчик статуса периода, когда тот же
   * файл пришёл повторно (`unchanged`) и импорт сам их не считал.
   */
  async countUnknown(
    telegramUserId: string,
    documentId: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<number> {
    const [{ total }] = await executor
      .select({ total: count() })
      .from(t)
      .where(
        and(
          eq(t.telegramUserId, telegramUserId),
          eq(t.lastDocumentId, documentId),
          eq(t.article, 'unknown'),
          isNull(t.supersededAt),
        ),
      );
    return total;
  }

  /**
   * Операции продавца, начисленные в окне, вместе со снятыми — вход
   * сопоставления ручного файла (TASK-114). Снятые нужны, чтобы старый файл не
   * оживил строку, которую новая версия Маркета уже заменила.
   */
  async existingBetween(
    telegramUserId: string,
    accruedFrom: Date,
    accruedTo: Date,
    executor: TFinanceExecutor = this.db,
  ): Promise<IFinanceExistingOperation[]> {
    const found = await executor
      .select({ operationKey: t.operationKey, raw: t.raw, supersededAt: t.supersededAt })
      .from(t)
      .where(
        and(
          eq(t.marketplace, 'ym'),
          eq(t.telegramUserId, telegramUserId),
          gte(t.accruedAt, accruedFrom),
          lte(t.accruedAt, accruedTo),
        ),
      );
    return found.map((r) => ({
      operationKey: r.operationKey,
      raw: (r.raw ?? {}) as Record<string, unknown>,
      superseded: r.supersededAt !== null,
    }));
  }

  /**
   * Живые операции продавца, начисленные в окне, — вход сверки (TASK-113).
   * Не по периоду: начисления и выплаты по заказу лежат и в соседних отчётах.
   * Окно ограничивает журнал, который растёт годами; идёт по частичному индексу
   * `(telegram_user_id, accrued_at) WHERE superseded_at IS NULL`.
   */
  async liveForReconcile(
    telegramUserId: string,
    accruedFrom: Date,
    accruedTo: Date,
    marketplace: TFinanceMarketplace = 'ym',
    executor: TFinanceExecutor = this.db,
  ): Promise<IReconcileOperation[]> {
    return await executor
      .select({
        id: t.id,
        orderId: t.orderId,
        article: t.article,
        amountKopecks: t.amountKopecks,
        bankOrderId: t.bankOrderId,
        bankSumKopecks: t.bankSumKopecks,
        paidAt: t.paidAt,
        periodKey: t.periodKey,
      })
      .from(t)
      .where(
        and(
          eq(t.marketplace, marketplace),
          eq(t.telegramUserId, telegramUserId),
          isNull(t.supersededAt),
          gte(t.accruedAt, accruedFrom),
          lte(t.accruedAt, accruedTo),
        ),
      );
  }

  /**
   * Дни актов (по Москве), строки которых лежат в периоде, — какие акты сверять
   * с отчётом услуг в этом месяце (TASK-158).
   */
  async actDaysOfPeriod(
    telegramUserId: string,
    periodKey: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<string[]> {
    const rows = await executor
      .selectDistinct({ day: ACT_DAY })
      .from(t)
      .where(
        and(
          eq(t.marketplace, 'ym'),
          eq(t.telegramUserId, telegramUserId),
          eq(t.periodKey, periodKey),
          isNull(t.supersededAt),
          isNotNull(t.actDate),
        ),
      );
    return rows.map((r) => r.day).sort();
  }

  /**
   * Σ живых строк журнала по дню акта — по ВСЕМУ журналу продавца, а не по
   * периоду: строка, которую последний импорт отнёс к соседнему месяцу, акта
   * не покидает, а дубль невозможен — ключ операции уникален. Строку читаем
   * целой: у сводной строки акта `amountKopecks` — вся сумма, расшифровка её
   * не меняет. Окно по `act_date` — для частичного индекса.
   */
  async actJournalSums(
    telegramUserId: string,
    actDays: readonly string[],
    executor: TFinanceExecutor = this.db,
  ): Promise<Map<string, IReconcileActJournal>> {
    const result = new Map<string, IReconcileActJournal>();
    if (!actDays.length) return result;
    const sorted = [...actDays].sort();
    const from = new Date(`${shiftDay(sorted[0], -1)}T00:00:00+03:00`);
    const to = new Date(`${shiftDay(sorted[sorted.length - 1], 2)}T00:00:00+03:00`);
    const rows = await executor
      .select({
        day: ACT_DAY,
        kopecks: sql<string>`coalesce(sum(${t.amountKopecks}), 0)`,
        operationCount: count(),
        ids: sql<string[]>`(array_agg(${t.id}::text ORDER BY ${t.accruedAt}, ${t.id}))[1:${sql.raw(
          String(MAX_FINDING_OPERATION_REFS),
        )}]`,
      })
      .from(t)
      .where(
        and(
          eq(t.marketplace, 'ym'),
          eq(t.telegramUserId, telegramUserId),
          isNull(t.supersededAt),
          gte(t.actDate, from),
          lt(t.actDate, to),
        ),
      )
      .groupBy(ACT_DAY);
    const wanted = new Set(actDays);
    for (const row of rows) {
      if (!wanted.has(row.day)) continue;
      result.set(row.day, {
        kopecks: Number(row.kopecks),
        operationCount: row.operationCount,
        operationIds: row.ids ?? [],
      });
    }
    return result;
  }

  /**
   * Живые операции продавца для P&L (TASK-120): начисленные в окне — тело
   * отчёта, плюс выплаченные в окне строки налоговой базы — для налога по дате
   * поступления (начислены они могли раньше). Два запроса вместо OR: первый
   * идёт по частичному индексу `(telegram_user_id, accrued_at)`, OR его бы
   * потерял. Объединение — по id.
   *
   * `count` колонки не имеет и читается из сырой строки отчёта.
   */
  async liveForPnl(
    telegramUserId: string,
    from: Date,
    to: Date,
    marketplace: TFinanceMarketplace = 'ym',
    executor: TFinanceExecutor = this.db,
  ): Promise<IPnlOperation[]> {
    const columns = {
      id: t.id,
      article: t.article,
      amountKopecks: t.amountKopecks,
      orderId: t.orderId,
      sku: t.sku,
      serviceName: t.serviceName,
      transactionType: t.transactionType,
      transactionSource: t.transactionSource,
      accruedAt: t.accruedAt,
      paidAt: t.paidAt,
      actDate: t.actDate,
      model: t.model,
      marketplace: t.marketplace,
      count: COUNT_OF[marketplace],
      breakdown: t.breakdown,
    };
    const live = and(
      eq(t.marketplace, marketplace),
      eq(t.telegramUserId, telegramUserId),
      isNull(t.supersededAt),
    );
    const taxArticles = FINANCE_ARTICLE_KEYS.filter((key) => TAX_BASE_ARTICLES[key]);

    const [accrued, paid] = await Promise.all([
      executor
        .select(columns)
        .from(t)
        .where(and(live, gte(t.accruedAt, from), lt(t.accruedAt, to))),
      executor
        .select(columns)
        .from(t)
        .where(and(live, gte(t.paidAt, from), lt(t.paidAt, to), inArray(t.article, taxArticles))),
    ]);

    const byId = new Map<string, (typeof accrued)[number]>();
    for (const row of [...accrued, ...paid]) byId.set(row.id, row);
    // Сводная строка с расшифровкой — по строке на статью (TASK-155): все
    // потребители P&L складывают статьи из частей, а не из «прочих услуг».
    return expandBreakdown([...byId.values()]);
  }

  /**
   * Живые операции заказов площадки (TASK-144, «Лента заказов») — строки с
   * номером из списка, в том же виде, что `liveForPnl`: прибыль заказа считается
   * тем же правилом себестоимости, что P&L. Номер — как его пишет импорт
   * площадки: ЯМ — id заказа, Ozon — posting_number, WB — srid. Идёт по
   * частичному индексу `(telegram_user_id, marketplace, order_id)`, пачками —
   * у Postgres потолок параметров на запрос.
   */
  async liveByOrderIds(
    telegramUserId: string,
    orderIds: readonly string[],
    marketplace: TFinanceMarketplace = 'ym',
    executor: TFinanceExecutor = this.db,
  ): Promise<IPnlOperation[]> {
    const unique = [...new Set(orderIds.filter(Boolean))];
    const rows: IPnlOperation[] = [];
    for (let i = 0; i < unique.length; i += UPSERT_CHUNK_SIZE) {
      const chunk = unique.slice(i, i + UPSERT_CHUNK_SIZE);
      const part = await executor
        .select({
          id: t.id,
          article: t.article,
          amountKopecks: t.amountKopecks,
          orderId: t.orderId,
          sku: t.sku,
          serviceName: t.serviceName,
          transactionType: t.transactionType,
          transactionSource: t.transactionSource,
          accruedAt: t.accruedAt,
          paidAt: t.paidAt,
          actDate: t.actDate,
          model: t.model,
          marketplace: t.marketplace,
          count: COUNT_OF[marketplace],
          breakdown: t.breakdown,
        })
        .from(t)
        .where(
          and(
            eq(t.telegramUserId, telegramUserId),
            eq(t.marketplace, marketplace),
            inArray(t.orderId, chunk),
            isNull(t.supersededAt),
          ),
        )
        .orderBy(t.accruedAt, t.id);
      rows.push(...expandBreakdown(part));
    }
    return rows;
  }

  /**
   * Живые строки, выплаченные в окне `[from, to)` (TASK-122): поступления ДДС и
   * «фактические выплаты». Идёт по частичному индексу `(telegram_user_id,
   * paid_at)`; строки поручения собираются по всему журналу, а не по периоду
   * отчёта — выплата 05.10 лежит частью в сентябрьском отчёте.
   */
  async livePaidBetween(
    telegramUserId: string,
    from: Date,
    to: Date,
    marketplace: TFinanceMarketplace = 'ym',
    executor: TFinanceExecutor = this.db,
  ): Promise<IPaidOperation[]> {
    const rows = await executor
      .select({
        id: t.id,
        article: t.article,
        amountKopecks: t.amountKopecks,
        bankOrderId: t.bankOrderId,
        bankSumKopecks: t.bankSumKopecks,
        paidAt: t.paidAt,
      })
      .from(t)
      .where(
        and(
          eq(t.marketplace, marketplace),
          eq(t.telegramUserId, telegramUserId),
          isNull(t.supersededAt),
          isNotNull(t.paidAt),
          gte(t.paidAt, from),
          lt(t.paidAt, to),
        ),
      );
    // paid_at IS NOT NULL в фильтре — тип колонки об этом не знает.
    return rows.map((row) => ({ ...row, paidAt: row.paidAt as Date }));
  }

  /**
   * Деньги к получению (TASK-122): живые строки, начисленные до `before` и ещё
   * не выплаченные, — сумма и число по статьям. Агрегирует база: страница
   * строк в JS молча теряла бы всё за потолком.
   */
  async receivableByArticle(
    telegramUserId: string,
    before: Date,
    marketplace: TFinanceMarketplace = 'ym',
    executor: TFinanceExecutor = this.db,
  ): Promise<IReceivableRow[]> {
    const rows = await executor
      .select({
        article: t.article,
        kopecks: sql<string>`coalesce(sum(${t.amountKopecks}), 0)`,
        operationCount: count(),
      })
      .from(t)
      .where(
        and(
          eq(t.marketplace, marketplace),
          eq(t.telegramUserId, telegramUserId),
          isNull(t.supersededAt),
          isNull(t.paidAt),
          lt(t.accruedAt, before),
          isNull(t.breakdown),
        ),
      )
      .groupBy(t.article);
    // Строки с расшифровкой (TASK-155) — единицы на акт: читаются отдельно и
    // раскладываются по статьям той же `expandBreakdown`, что у P&L.
    const split = await executor
      .select({ article: t.article, amountKopecks: t.amountKopecks, breakdown: t.breakdown })
      .from(t)
      .where(
        and(
          eq(t.marketplace, marketplace),
          eq(t.telegramUserId, telegramUserId),
          isNull(t.supersededAt),
          isNull(t.paidAt),
          lt(t.accruedAt, before),
          isNotNull(t.breakdown),
        ),
      );
    const byArticle = new Map<string, IReceivableRow>();
    // SUM(bigint) Postgres отдаёт numeric — строкой; копейки далеко внутри 2^53.
    for (const row of rows) {
      byArticle.set(row.article, {
        article: row.article,
        kopecks: Number(row.kopecks),
        operationCount: Number(row.operationCount),
      });
    }
    for (const part of expandBreakdown(split)) {
      const entry = byArticle.get(part.article) ?? {
        article: part.article,
        kopecks: 0,
        operationCount: 0,
      };
      entry.kopecks += part.amountKopecks;
      entry.operationCount += 1;
      byArticle.set(part.article, entry);
    }
    return [...byArticle.values()];
  }

  /**
   * Операции по id — раскрытие статьи P&L до строк журнала (TASK-124). id
   * берутся из `IPnlBucket.operationIds`, поэтому сумма раскрытия равна сумме
   * статьи по построению. Фильтр «живые» не нужен — P&L их уже отобрал; фильтр
   * по продавцу обязателен — id приходят из браузера.
   */
  async byIds(
    telegramUserId: string,
    ids: readonly string[],
    executor: TFinanceExecutor = this.db,
  ): Promise<IFinanceScreenOperation[]> {
    if (!ids.length) return [];
    return executor
      .select({
        id: t.id,
        article: t.article,
        amountKopecks: t.amountKopecks,
        orderId: t.orderId,
        sku: t.sku,
        serviceName: t.serviceName,
        transactionType: t.transactionType,
        transactionSource: t.transactionSource,
        accruedAt: t.accruedAt,
        paidAt: t.paidAt,
        actDate: t.actDate,
        bankOrderId: t.bankOrderId,
        documentId: t.lastDocumentId,
        count: sql<string | null>`${t.raw}->>'count'`,
        breakdown: t.breakdown,
      })
      .from(t)
      .where(and(eq(t.telegramUserId, telegramUserId), inArray(t.id, [...ids])))
      .orderBy(t.accruedAt, t.id);
  }

  /**
   * Расшифровки живых операций по ключам (TASK-155): импорт не заказывает отчёт
   * услуг под акт, у сводной строки которого расшифровка уже есть, — квота
   * генераций 100/ч.
   */
  async breakdownsByKeys(
    telegramUserId: string,
    operationKeys: readonly string[],
    executor: TFinanceExecutor = this.db,
  ): Promise<Map<string, IOperationBreakdownPart[]>> {
    const result = new Map<string, IOperationBreakdownPart[]>();
    if (!operationKeys.length) return result;
    const found = await executor
      .select({ operationKey: t.operationKey, breakdown: t.breakdown })
      .from(t)
      .where(
        and(
          eq(t.marketplace, 'ym'),
          eq(t.telegramUserId, telegramUserId),
          inArray(t.operationKey, [...operationKeys]),
          isNotNull(t.breakdown),
        ),
      );
    for (const row of found) {
      const parts = breakdownOf(row.breakdown);
      if (parts) result.set(row.operationKey, parts);
    }
    return result;
  }

  /**
   * Дописать расшифровку уже записанным операциям — когда журнал пришёл тем же
   * файлом (`unchanged`), а отчёт услуг в прошлый раз не загрузился.
   */
  async setBreakdowns(
    telegramUserId: string,
    breakdowns: ReadonlyMap<string, IOperationBreakdownPart[]>,
    executor: TFinanceExecutor = this.db,
  ): Promise<number> {
    let modified = 0;
    for (const [operationKey, breakdown] of breakdowns) {
      const updated = await executor
        .update(t)
        .set({ breakdown, updatedAt: new Date() })
        .where(
          and(
            eq(t.marketplace, 'ym'),
            eq(t.telegramUserId, telegramUserId),
            eq(t.operationKey, operationKey),
          ),
        )
        .returning({ id: t.id });
      modified += updated.length;
    }
    return modified;
  }
}
