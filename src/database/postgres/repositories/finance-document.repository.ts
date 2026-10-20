import type { TFinanceDb, TFinanceExecutor } from '../finance-db';
import type {
  TFinanceDocumentSource,
  TFinanceDocumentStatus,
  TFinanceMarketplace,
} from '../finance.schema';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';

import { FINANCE_DB } from '../finance-db';
import { FINANCE_ORIGINAL_MAX_BYTES, financeDocuments } from '../finance.schema';

export interface IFinancePeriodRef {
  marketplace: TFinanceMarketplace;
  telegramUserId: string;
  reportType: string;
  periodFrom: string;
  periodTo: string;
}

export interface IFinanceDocumentInput extends IFinancePeriodRef {
  businessId: string;
  buffer: Buffer;
  filename: string;
  contentType: string;
  /** Умолчание — `api`: импорт Маркета. */
  source?: TFinanceDocumentSource;
}

/** Версия документа без оригинала — он нужен только для скачивания. */
export interface IFinanceDocumentVersion {
  id: string;
  marketplace: TFinanceMarketplace;
  telegramUserId: string;
  businessId: string;
  reportType: string;
  periodFrom: string;
  periodTo: string;
  version: number;
  contentHash: string;
  status: TFinanceDocumentStatus;
  source: TFinanceDocumentSource;
  rowCount: number | null;
  error: string | null;
  originalTooLarge: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IFinanceOriginalFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

export interface IFinanceVersionResult {
  document: IFinanceDocumentVersion;
  /** false — этот же файл уже загружен, новая версия не заведена. */
  created: boolean;
}

const t = financeDocuments;

/** Колонки версии — всё, кроме тяжёлого оригинала. */
const VERSION_COLUMNS = {
  id: t.id,
  marketplace: t.marketplace,
  telegramUserId: t.telegramUserId,
  businessId: t.businessId,
  reportType: t.reportType,
  periodFrom: t.periodFrom,
  periodTo: t.periodTo,
  version: t.version,
  contentHash: t.contentHash,
  status: t.status,
  source: t.source,
  rowCount: t.rowCount,
  error: t.error,
  originalTooLarge: t.originalTooLarge,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
};

/**
 * Версии загруженных финансовых отчётов (Postgres). Скоуп — telegramUserId в
 * каждом условии. Последний аргумент — база или открытая транзакция.
 */
@Injectable()
export class FinanceDocumentRepository {
  private readonly logger = new Logger(FinanceDocumentRepository.name);

  constructor(@Inject(FINANCE_DB) private readonly db: TFinanceDb) {}

  /**
   * Завести версию отчёта за период.
   *
   * Тот же файл (тот же sha256), что у последней версии, новой версии не
   * создаёт — возвращается существующая с `created: false`. Иначе — номер
   * последней плюс один. Две параллельные загрузки одного периода упрутся в
   * уникальный индекс по номеру версии, и вторая получит 23505.
   */
  async registerVersion(
    input: IFinanceDocumentInput,
    executor: TFinanceExecutor = this.db,
  ): Promise<IFinanceVersionResult> {
    const contentHash = createHash('sha256').update(input.buffer).digest('hex');
    const latest = await this.latest(input, executor);

    if (latest?.contentHash === contentHash) {
      return { document: latest, created: false };
    }

    const size = input.buffer.length;
    const tooLarge = size > FINANCE_ORIGINAL_MAX_BYTES;
    if (tooLarge) {
      this.logger.warn(
        `Оригинал ${input.reportType} ${input.periodFrom}…${input.periodTo} для ` +
          `${input.telegramUserId}: ${size} байт больше потолка — не сохраняю`,
      );
    }

    const [document] = await executor
      .insert(t)
      .values({
        marketplace: input.marketplace,
        telegramUserId: input.telegramUserId,
        businessId: input.businessId,
        reportType: input.reportType,
        periodFrom: input.periodFrom,
        periodTo: input.periodTo,
        version: (latest?.version ?? 0) + 1,
        contentHash,
        status: 'pending',
        source: input.source ?? 'api',
        original: tooLarge ? null : input.buffer,
        originalFilename: tooLarge ? null : input.filename,
        originalContentType: tooLarge ? null : input.contentType,
        originalSize: size,
        originalTooLarge: tooLarge,
      })
      .returning(VERSION_COLUMNS);

    return { document, created: true };
  }

  /** Последняя версия периода — без оригинала. */
  async latest(
    period: IFinancePeriodRef,
    executor: TFinanceExecutor = this.db,
  ): Promise<IFinanceDocumentVersion | null> {
    const [found] = await executor
      .select(VERSION_COLUMNS)
      .from(t)
      .where(
        and(
          eq(t.marketplace, period.marketplace),
          eq(t.telegramUserId, period.telegramUserId),
          eq(t.reportType, period.reportType),
          eq(t.periodFrom, period.periodFrom),
          eq(t.periodTo, period.periodTo),
        ),
      )
      .orderBy(desc(t.version))
      .limit(1);
    return found ?? null;
  }

  /** Оригинал версии — для скачивания и разбора спорных случаев. */
  async original(telegramUserId: string, id: string): Promise<Buffer | null> {
    const [found] = await this.db
      .select({ original: t.original })
      .from(t)
      .where(and(eq(t.id, id), eq(t.telegramUserId, telegramUserId)));
    return found?.original ?? null;
  }

  /**
   * Оригинал с именем и типом — скачивание из CRM (TASK-124). null — версии
   * нет, она чужая или оригинал не сохранён (`originalTooLarge`).
   */
  async originalFile(telegramUserId: string, id: string): Promise<IFinanceOriginalFile | null> {
    const [found] = await this.db
      .select({
        buffer: t.original,
        filename: t.originalFilename,
        contentType: t.originalContentType,
      })
      .from(t)
      .where(and(eq(t.id, id), eq(t.telegramUserId, telegramUserId)));
    if (!found?.buffer) return null;
    return {
      buffer: found.buffer,
      filename: found.filename ?? `finance-${id}.zip`,
      contentType: found.contentType ?? 'application/octet-stream',
    };
  }

  async markImported(
    telegramUserId: string,
    id: string,
    rowCount: number,
    executor: TFinanceExecutor = this.db,
  ): Promise<void> {
    await executor
      .update(t)
      .set({ status: 'imported', rowCount, error: null, updatedAt: new Date() })
      .where(and(eq(t.id, id), eq(t.telegramUserId, telegramUserId)));
  }

  async markFailed(
    telegramUserId: string,
    id: string,
    error: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<void> {
    await executor
      .update(t)
      .set({ status: 'failed', error, updatedAt: new Date() })
      .where(and(eq(t.id, id), eq(t.telegramUserId, telegramUserId)));
  }
}
