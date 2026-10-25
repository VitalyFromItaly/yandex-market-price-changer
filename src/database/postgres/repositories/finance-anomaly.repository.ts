import type { IAnomaly, TAnomalyKind } from '../../../modules/finance/finance-anomalies';
import type { TFinanceDb } from '../finance-db';
import type { TFinanceMarketplace } from '../finance.schema';

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

import { ANOMALY_KINDS } from '../../../modules/finance/finance-anomalies';
import { FINANCE_DB } from '../finance-db';
import { financeAnomalies, financeAnomalyReviews, financePeriods } from '../finance.schema';

/** Потолок страницы — довод MAX_FINANCE_DISCREPANCIES_PAGE. */
export const MAX_FINANCE_ANOMALIES_PAGE = 100;

/** Сколько ключей отмечается одним запросом: отметить «все на странице» — до потолка страницы. */
export const MAX_ANOMALY_REVIEW_KEYS = MAX_FINANCE_ANOMALIES_PAGE;

export interface IFinanceAnomaliesScope {
  marketplace: TFinanceMarketplace;
  telegramUserId: string;
  periodKey: string;
}

export interface IFinanceAnomaliesQuery {
  telegramUserId: string;
  /** Площадка журнала (TASK-180); не задана — все площадки периода (ключ периода и так её несёт). */
  marketplace?: TFinanceMarketplace;
  periodKey: string;
  /** true — только непросмотренные. */
  unreviewedOnly?: boolean;
  limit?: number;
  skip?: number;
}

export interface IFinanceAnomalyRow {
  key: string;
  kind: TAnomalyKind;
  operationIds: string[];
  operationCount: number;
  amountKopecks: number | null;
  sku: string | null;
  orderId: string | null;
  threshold: string;
  detail: string;
  /** Отметка есть и отпечаток совпал. */
  reviewed: boolean;
}

export interface IFinanceAnomaliesPage {
  items: IFinanceAnomalyRow[];
  /** Всего под фильтром. */
  total: number;
  /** Непросмотренных в месяце — независимо от фильтра. */
  unreviewed: number;
}

/** Сколько аномалий в одном INSERT: строка — 14 параметров, до потолка 65 535 далеко. */
const INSERT_CHUNK_SIZE = 1000;

const a = financeAnomalies;

/**
 * Порядок видов — как у детектора (`ANOMALY_KINDS`), а не по алфавиту ключа:
 * комиссия и дубли важнее «нет закупа». Литералы — константы кода, не ввод.
 */
const KIND_ORDER = sql.raw(`ARRAY[${ANOMALY_KINDS.map((kind) => `'${kind}'`).join(',')}]::text[]`);
const r = financeAnomalyReviews;

/**
 * Аномалии журнала (TASK-149). Пишет детектор, читает экран «Финансы».
 * Скоуп — telegramUserId в каждом условии; ключи из браузера сверяются с
 * аномалиями продавца, чужой или выдуманный ключ не отмечается.
 */
@Injectable()
export class FinanceAnomalyRepository {
  constructor(@Inject(FINANCE_DB) private readonly db: TFinanceDb) {}

  /**
   * Заменить аномалии периода целиком и отметить, что месяц проверен, — одной
   * транзакцией: между удалением и вставкой экран не увидит «аномалий нет».
   * Отметки «просмотрено» не трогаются: они в своей таблице.
   */
  async replacePeriod(
    scope: IFinanceAnomaliesScope,
    anomalies: readonly IAnomaly[],
    checkedAt: Date,
  ): Promise<number> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(a)
        .where(
          and(
            eq(a.marketplace, scope.marketplace),
            eq(a.telegramUserId, scope.telegramUserId),
            eq(a.periodKey, scope.periodKey),
          ),
        );
      for (let i = 0; i < anomalies.length; i += INSERT_CHUNK_SIZE) {
        await tx.insert(a).values(
          anomalies.slice(i, i + INSERT_CHUNK_SIZE).map((x) => ({
            ...scope,
            kind: x.kind,
            anomalyKey: x.key,
            fingerprint: x.fingerprint,
            operationIds: x.operationIds,
            operationCount: x.operationCount,
            amountKopecks: x.amountKopecks,
            sku: x.sku,
            orderId: x.orderId,
            threshold: x.threshold,
            detail: x.detail,
          })),
        );
      }
      await tx
        .update(financePeriods)
        .set({ anomaliesCheckedAt: checkedAt })
        .where(
          and(
            eq(financePeriods.marketplace, scope.marketplace),
            eq(financePeriods.telegramUserId, scope.telegramUserId),
            eq(financePeriods.periodKey, scope.periodKey),
          ),
        );
    });
    return anomalies.length;
  }

  /** Когда месяц проверялся; null — ни разу (или период ещё не загружался). */
  async checkedAt(scope: IFinanceAnomaliesScope): Promise<Date | null> {
    const [row] = await this.db
      .select({ at: financePeriods.anomaliesCheckedAt })
      .from(financePeriods)
      .where(
        and(
          eq(financePeriods.marketplace, scope.marketplace),
          eq(financePeriods.telegramUserId, scope.telegramUserId),
          eq(financePeriods.periodKey, scope.periodKey),
        ),
      );
    return row?.at ?? null;
  }

  async list(query: IFinanceAnomaliesQuery): Promise<IFinanceAnomaliesPage> {
    const reviewed = and(isNotNull(r.id), eq(r.fingerprint, a.fingerprint));
    const join = and(
      eq(r.marketplace, a.marketplace),
      eq(r.telegramUserId, a.telegramUserId),
      eq(r.anomalyKey, a.anomalyKey),
    );
    const scope = and(
      eq(a.telegramUserId, query.telegramUserId),
      eq(a.periodKey, query.periodKey),
      query.marketplace ? eq(a.marketplace, query.marketplace) : undefined,
    );
    const notReviewed = or(isNull(r.id), sql`${r.fingerprint} <> ${a.fingerprint}`);
    const where = query.unreviewedOnly ? and(scope, notReviewed) : scope;
    const limit = Math.min(Math.max(query.limit ?? 50, 1), MAX_FINANCE_ANOMALIES_PAGE);
    const offset = Math.max(query.skip ?? 0, 0);

    const [rows, [{ total }], [{ unreviewed }]] = await Promise.all([
      this.db
        .select({
          key: a.anomalyKey,
          kind: a.kind,
          operationIds: a.operationIds,
          operationCount: a.operationCount,
          amountKopecks: a.amountKopecks,
          sku: a.sku,
          orderId: a.orderId,
          threshold: a.threshold,
          detail: a.detail,
          reviewed: sql<boolean>`coalesce(${reviewed}, false)`,
        })
        .from(a)
        .leftJoin(r, join)
        .where(where)
        // Непросмотренные сверху, дальше — порядок детектора по виду и ключу.
        .orderBy(
          sql`coalesce(${reviewed}, false)`,
          sql`array_position(${KIND_ORDER}, ${a.kind})`,
          asc(a.anomalyKey),
        )
        .limit(limit)
        .offset(offset),
      this.db.select({ total: count() }).from(a).leftJoin(r, join).where(where),
      this.db
        .select({ unreviewed: count() })
        .from(a)
        .leftJoin(r, join)
        .where(and(scope, notReviewed)),
    ]);
    return {
      items: rows.map((row) => ({ ...row, reviewed: Boolean(row.reviewed) })),
      total,
      unreviewed,
    };
  }

  /**
   * Отметить аномалии продавца просмотренными (с их текущим отпечатком) или
   * снять отметку. Возвращает, сколько ключей нашлось у продавца.
   */
  async setReviewed(
    marketplace: TFinanceMarketplace,
    telegramUserId: string,
    keys: readonly string[],
    reviewed: boolean,
  ): Promise<number> {
    if (!keys.length) return 0;
    const own = await this.db
      .select({ key: a.anomalyKey, fingerprint: a.fingerprint })
      .from(a)
      .where(
        and(
          eq(a.marketplace, marketplace),
          eq(a.telegramUserId, telegramUserId),
          inArray(a.anomalyKey, [...keys]),
        ),
      );
    if (!own.length) return 0;
    if (!reviewed) {
      await this.db.delete(r).where(
        and(
          eq(r.marketplace, marketplace),
          eq(r.telegramUserId, telegramUserId),
          inArray(
            r.anomalyKey,
            own.map((row) => row.key),
          ),
        ),
      );
      return own.length;
    }
    await this.db
      .insert(r)
      .values(
        own.map((row) => ({
          marketplace,
          telegramUserId,
          anomalyKey: row.key,
          fingerprint: row.fingerprint,
        })),
      )
      .onConflictDoUpdate({
        target: [r.marketplace, r.telegramUserId, r.anomalyKey],
        set: { fingerprint: sql`excluded.fingerprint`, reviewedAt: new Date() },
      });
    return own.length;
  }
}
