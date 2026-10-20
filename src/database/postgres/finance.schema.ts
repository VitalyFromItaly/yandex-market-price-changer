import type { TExpenseKind } from '../../modules/finance/expense.domain';
import type { TAnomalyKind } from '../../modules/finance/finance-anomalies';
import type { TFinanceArticle } from '../../modules/finance/finance-articles';
import type {
  IFinanceCorrectionSide,
  TFinanceCorrectionKind,
} from '../../modules/finance/finance-corrections';
import type {
  TFinanceImportOutcome,
  TFinancePeriodStatus,
  TFinanceReconcileStateKey,
} from '../../modules/finance/finance-period-status';
import type { TReconcileKind } from '../../modules/finance/finance-reconcile';
import type { IOperationBreakdownPart } from '../../modules/finance/operation-breakdown';
import type { IPurchaseLine } from '../../modules/finance/purchase.domain';
import type { TTaxReductionKind, TTaxYearPeriod } from '../../modules/finance/tax-year.domain';
import type { TTaxRecognition, TTaxRegime } from '../../modules/finance/tax.domain';
import type { TMarketplace } from '../../shared/marketplace';

import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Финансовый журнал в Postgres (решение `finance_postgres`, 2026-10-15).
 *
 * Почему не Mongo, где живёт всё остальное. Mongo прода — один узел без replica
 * set, транзакций там нет, а замена версии отчёта периода — это регистрация
 * версии, upsert десятков тысяч операций, снятие выпавших и запись корректировок
 * разом: оборвись она посередине, период остался бы наполовину старым. Второе —
 * финдвижку (M18) нужны SUM/GROUP BY по десяткам тысяч строк, это родное для SQL.
 *
 * Имена колонок — snake_case, поля в коде — camelCase (Drizzle сопоставляет).
 * Деньги — bigint копеек в режиме number: копейки любой мыслимой суммы журнала
 * далеко внутри 2^53, а bigint вместо integer — потому что integer кончается на
 * 21 млн рублей, и годовой оборот продавца в него уже не влезает.
 *
 * Схему меняют только миграциями: `npm run db:pg:generate` после правки этого
 * файла, применяются при старте приложения и `npm run db:pg:migrate`.
 */

// Подмножество общего `TMarketplace` (src/shared/marketplace.ts): журнал знает
// только площадки, у которых есть импорт. Ozon — с TASK-131, WB — с TASK-136.
// Ограничения в базе нет (ни enum, ни CHECK) — площадка держится типом,
// поэтому миграция для новой не нужна.
export const FINANCE_MARKETPLACES = ['ym', 'ozon', 'wb'] as const satisfies readonly TMarketplace[];
export type TFinanceMarketplace = (typeof FINANCE_MARKETPLACES)[number];

export const FINANCE_DIRECTIONS = ['income', 'expense'] as const;
export type TFinanceDirection = (typeof FINANCE_DIRECTIONS)[number];

export const FINANCE_DOCUMENT_STATUSES = ['pending', 'imported', 'failed'] as const;
export type TFinanceDocumentStatus = (typeof FINANCE_DOCUMENT_STATUSES)[number];

/**
 * Откуда версия: `api` — импорт отчёта Маркета, `manual` — файл, загруженный
 * продавцом в CRM (TASK-114). Ручная версия только добавляет операции и ничего
 * не снимает (решение `finance_upload_append_only`).
 */
export const FINANCE_DOCUMENT_SOURCES = ['api', 'manual'] as const;
export type TFinanceDocumentSource = (typeof FINANCE_DOCUMENT_SOURCES)[number];

/**
 * Потолок оригинала в строке документа. bytea держит до гигабайта, но тащить
 * такие файлы в каждую выборку версии незачем; ZIP united-netting за месяц на
 * ~21 тыс. строк в разы меньше. Превышение не роняет загрузку — оригинал не
 * пишется, ставится `originalTooLarge`: операции важнее архива.
 */
export const FINANCE_ORIGINAL_MAX_BYTES = 15 * 1024 * 1024;

/**
 * bytea → Buffer. `pg` отдаёт Buffer, PGlite (тесты) — Uint8Array: без
 * приведения `toString()` в тесте и в проде давали бы разное.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => 'bytea',
  fromDriver: (value) => (Buffer.isBuffer(value) ? value : Buffer.from(value)),
});

const money = (name: string) => bigint(name, { mode: 'number' });
const moment = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * Загруженный отчёт площадки за период — одна ВЕРСИЯ.
 *
 * Ключ операции строится из её суммы (своего id у строки ЯМ нет), поэтому
 * пересчитанная Маркетом строка получает новый ключ, и upsert её не заменит.
 * Значит, период заменяется целиком: новый файл (другой sha256) — версия N+1,
 * тот же файл новой версии не создаёт. TTL нет: версии — история по ТЗ.
 */
export const financeDocuments = pgTable(
  'finance_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketplace: text('marketplace').$type<TFinanceMarketplace>().notNull(),
    telegramUserId: text('telegram_user_id').notNull(),
    businessId: text('business_id').notNull(),
    /** У ЯМ — `united-netting`. */
    reportType: text('report_type').notNull(),
    /** «ГГГГ-ММ-ДД» по Москве: календарный день, а не момент. */
    periodFrom: text('period_from').notNull(),
    periodTo: text('period_to').notNull(),
    version: integer('version').notNull(),
    contentHash: text('content_hash').notNull(),
    status: text('status').$type<TFinanceDocumentStatus>().notNull().default('pending'),
    source: text('source').$type<TFinanceDocumentSource>().notNull().default('api'),
    rowCount: integer('row_count'),
    error: text('error'),
    original: bytea('original'),
    originalFilename: text('original_filename'),
    originalContentType: text('original_content_type'),
    originalSize: integer('original_size'),
    originalTooLarge: boolean('original_too_large').notNull().default(false),
    createdAt: moment('created_at').notNull().defaultNow(),
    updatedAt: moment('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // Одна версия с данным номером на период; гонка двух загрузок упрётся сюда.
    uniqueIndex('finance_documents_period_version_uq').on(
      t.marketplace,
      t.telegramUserId,
      t.reportType,
      t.periodFrom,
      t.periodTo,
      t.version,
    ),
  ],
);

/**
 * Одна финансовая операция площадки — строка журнала (у ЯМ — united-netting).
 *
 * Дубль отсекает уникальный индекс `(marketplace, telegram_user_id,
 * operation_key)`, а не проверка в коде. Поля двух сортов, и репозиторий пишет
 * их по-разному: неизменяемые (сумма, дата, тип, raw, первая версия) — только
 * при вставке; изменяемые (выплата, статья, где строку видели последней,
 * снятие) — `ON CONFLICT DO UPDATE`.
 */
export const financeOperations = pgTable(
  'finance_operations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketplace: text('marketplace').$type<TFinanceMarketplace>().notNull(),
    telegramUserId: text('telegram_user_id').notNull(),
    /** Кабинет: журнал ЯМ бизнесовый, магазин — признак строки (`model`). */
    businessId: text('business_id').notNull(),
    operationKey: text('operation_key').notNull(),
    article: text('article').$type<TFinanceArticle>().notNull().default('unknown'),
    /** По знаку суммы: «+» — деньги продавцу, «−» — удержание. */
    direction: text('direction').$type<TFinanceDirection>().notNull(),
    amountKopecks: money('amount_kopecks').notNull(),
    orderId: text('order_id'),
    sku: text('sku'),
    /** Название услуги (у ЯМ — offerOrServiceName). */
    serviceName: text('service_name'),
    transactionType: text('transaction_type').notNull(),
    transactionSource: text('transaction_source'),
    accruedAt: moment('accrued_at').notNull(),
    actId: text('act_id'),
    actDate: moment('act_date'),
    /** FBS / FBY / … */
    model: text('model'),
    paymentStatus: text('payment_status'),
    /** Дата выплаты — пуста, пока Маркет не перевёл деньги. */
    paidAt: moment('paid_at'),
    bankOrderId: text('bank_order_id'),
    bankSumKopecks: money('bank_sum_kopecks'),
    /** Версия документа, из которой операция пришла впервые. */
    documentId: uuid('document_id')
      .notNull()
      .references(() => financeDocuments.id),
    documentVersion: integer('document_version').notNull(),
    /**
     * Где строку видели последний раз: период (`<reportType>:<from>:<to>`) и
     * версия. По ним импорт находит строки, снятые новой версией.
     */
    periodKey: text('period_key').notNull(),
    lastDocumentId: uuid('last_document_id')
      .notNull()
      .references(() => financeDocuments.id),
    lastDocumentVersion: integer('last_document_version').notNull(),
    /**
     * Строки нет в новой версии — пересчитана или убрана. Не удаляется:
     * история. Отчёты складывают только `superseded_at IS NULL`; вернувшаяся
     * строка оживает (upsert снова ставит NULL).
     */
    supersededAt: moment('superseded_at'),
    supersededByVersion: integer('superseded_by_version'),
    /** Исходная строка отчёта как есть — для спорных случаев и переклассификации. */
    raw: jsonb('raw').$type<Record<string, unknown>>().notNull(),
    /**
     * Расшифровка одной суммы по статьям (TASK-155): у ЯМ — сводная строка акта
     * по отчёту услуг. Пусто — операция читается своей статьёй целиком.
     * Изменяемое, но null не стирает записанное: ручная загрузка и импорт, у
     * которого отчёт услуг не загрузился, расшифровки не несут.
     */
    breakdown: jsonb('breakdown').$type<IOperationBreakdownPart[]>(),
    createdAt: moment('created_at').notNull().defaultNow(),
    updatedAt: moment('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // Повторная загрузка не удваивает операцию: дубль отсекает база.
    uniqueIndex('finance_operations_key_uq').on(t.marketplace, t.telegramUserId, t.operationKey),
    // Отчёты за период — по живым операциям.
    index('finance_operations_user_accrued_idx')
      .on(t.telegramUserId, t.accruedAt)
      .where(sql`${t.supersededAt} IS NULL`),
    // Импорт новой версии: операции периода, которых в ней не оказалось.
    index('finance_operations_period_idx').on(t.telegramUserId, t.periodKey, t.lastDocumentId),
    // ДДС и «фактические выплаты» (TASK-122) — по дате выплаты, а не начисления.
    index('finance_operations_user_paid_idx')
      .on(t.telegramUserId, t.paidAt)
      .where(sql`${t.supersededAt} IS NULL`),
    // Сверка акта с отчётом услуг (TASK-158): Σ живых строк по дате акта.
    index('finance_operations_user_act_idx')
      .on(t.telegramUserId, t.actDate)
      .where(sql`${t.supersededAt} IS NULL`),
    // «Лента заказов» (TASK-144): живые строки заказов площадки по номерам.
    index('finance_operations_user_order_idx')
      .on(t.telegramUserId, t.marketplace, t.orderId)
      .where(sql`${t.supersededAt} IS NULL`),
  ],
);

/**
 * Корректировка: строка, которую Маркет в новой версии отчёта периода
 * пересчитал (`changed`, было → стало) или убрал (`removed`). Выжимка без raw
 * (решение `finance_corrections_collection`).
 */
export const financeCorrections = pgTable(
  'finance_corrections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketplace: text('marketplace').$type<TFinanceMarketplace>().notNull(),
    telegramUserId: text('telegram_user_id').notNull(),
    businessId: text('business_id').notNull(),
    periodKey: text('period_key').notNull(),
    /** Версия документа, импорт которой обнаружил изменение. */
    documentId: uuid('document_id')
      .notNull()
      .references(() => financeDocuments.id),
    documentVersion: integer('document_version').notNull(),
    kind: text('kind').$type<TFinanceCorrectionKind>().notNull(),
    before: jsonb('before').$type<IFinanceCorrectionSide>().notNull(),
    after: jsonb('after').$type<IFinanceCorrectionSide | null>(),
    createdAt: moment('created_at').notNull().defaultNow(),
  },
  (t) => [index('finance_corrections_user_created_idx').on(t.telegramUserId, t.createdAt)],
);

/**
 * Статус периода (TASK-112): «Предварительные данные» / «Проверено» / «Есть
 * расхождения» и итог последней загрузки. Одна строка на продавца и период
 * (`period_key` — тот же ключ, что у операций), пишется после КАЖДОЙ загрузки,
 * удачной или нет: «когда грузили последний раз и чем кончилось» — вопрос
 * карточки в панели, и без строки на сбой ответа на него нет.
 *
 * Статус считается чистой `periodStatusOf` (finance-period-status.ts), здесь
 * только хранится. Счётчики — из последней ВЕРСИИ документа: повтор того же
 * файла (`unchanged`) их не обнуляет, иначе расхождения «исчезали» бы на
 * следующую ночь без всякой правки данных.
 */
export const financePeriods = pgTable(
  'finance_periods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketplace: text('marketplace').$type<TFinanceMarketplace>().notNull(),
    telegramUserId: text('telegram_user_id').notNull(),
    reportType: text('report_type').notNull(),
    periodKey: text('period_key').notNull(),
    periodFrom: text('period_from').notNull(),
    periodTo: text('period_to').notNull(),
    status: text('status').$type<TFinancePeriodStatus>().notNull(),
    /** Чем кончилась последняя загрузка: empty / unchanged / imported / failed. */
    lastOutcome: text('last_outcome').$type<TFinanceImportOutcome>().notNull(),
    /** Версия документа, по которой посчитаны счётчики; null — версии ещё нет. */
    documentVersion: integer('document_version'),
    unknownCount: integer('unknown_count').notNull().default(0),
    changedCount: integer('changed_count').notNull().default(0),
    removedCount: integer('removed_count').notNull().default(0),
    /** Находок сверки с заказами (TASK-113); список — finance_discrepancies. */
    discrepancyCount: integer('discrepancy_count').notNull().default(0),
    /** skipped / checked / unchecked / failed; null — сверки ещё не было. */
    reconcileState: text('reconcile_state').$type<TFinanceReconcileStateKey>(),
    /** Почему сверка не сделана или упала. */
    reconcileNote: text('reconcile_note'),
    /** Текст ошибки последней загрузки; null — загрузка прошла. */
    error: text('error'),
    /**
     * Когда месяц последний раз проверен детектором аномалий (TASK-149);
     * null — не проверялся. Экран отличает «не проверено» от «аномалий нет».
     */
    anomaliesCheckedAt: moment('anomalies_checked_at'),
    checkedAt: moment('checked_at').notNull(),
    createdAt: moment('created_at').notNull().defaultNow(),
    updatedAt: moment('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('finance_periods_key_uq').on(t.marketplace, t.telegramUserId, t.periodKey),
    // Карточка «Очереди» и экран «Финансы» читают периоды продавца.
    index('finance_periods_user_from_idx').on(t.telegramUserId, t.periodFrom),
  ],
);

/**
 * Находки сверки журнала с заказами и выплатами (TASK-113). Список целиком
 * заменяется каждой сверкой периода (`replacePeriod`): находка — вывод из
 * текущих данных, а не событие, и вчерашняя, которую сегодня закрыл соседний
 * отчёт, должна исчезнуть, а не висеть рядом с новой.
 *
 * Ссылки на операции — их id (uuid) в `operation_ids`, без внешнего ключа:
 * jsonb-массив, первые MAX_FINDING_OPERATION_REFS; всего — `operation_count`.
 */
export const financeDiscrepancies = pgTable(
  'finance_discrepancies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketplace: text('marketplace').$type<TFinanceMarketplace>().notNull(),
    telegramUserId: text('telegram_user_id').notNull(),
    periodKey: text('period_key').notNull(),
    kind: text('kind').$type<TReconcileKind>().notNull(),
    orderId: text('order_id'),
    bankOrderId: text('bank_order_id'),
    operationIds: jsonb('operation_ids').$type<string[]>().notNull(),
    operationCount: integer('operation_count').notNull(),
    expectedKopecks: money('expected_kopecks'),
    actualKopecks: money('actual_kopecks'),
    detail: text('detail').notNull(),
    createdAt: moment('created_at').notNull().defaultNow(),
  },
  (t) => [index('finance_discrepancies_period_idx').on(t.telegramUserId, t.periodKey)],
);

/**
 * Итог акта ЯМ в отчёте услуг united-marketplace-services (TASK-158) — сторона
 * сверки «Σ услуг акта = −Σ строк журнала той же actDate». Одна строка на акт
 * продавца; сырые листы не храним — только суммы (лист → копейки).
 *
 * Зачем хранить, а не считать в сверке. Отчёт услуг — генерация из квоты
 * 100/ч и минуты Маркета, а сверка периода идёт и без импорта
 * (`reconcileAndRecord`). Импорт заказывает отчёт под акт, итога которого нет
 * или он не сошёлся с журналом на последней сверке (`journal_matched = false`),
 * и пишет итог в той же транзакции, что версию журнала. Сравнивать с журналом в
 * импорте нельзя: строки акта лежат в отчётах двух месяцев (акт 30.09 — и в
 * сентябрьском, и в октябрьском), и сравнение с одним отчётом перезаказывало бы
 * отчёт услуг каждую ночь.
 */
export const financeActServices = pgTable(
  'finance_act_services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketplace: text('marketplace').$type<TFinanceMarketplace>().notNull(),
    telegramUserId: text('telegram_user_id').notNull(),
    /** День акта по Москве, ГГГГ-ММ-ДД. */
    actDay: text('act_day').notNull(),
    /** Стоимость услуг акта, «+». */
    totalKopecks: money('total_kopecks').notNull(),
    sheets: jsonb('sheets').$type<Record<string, number>>().notNull(),
    loadedAt: moment('loaded_at').notNull(),
    /**
     * Сошёлся ли итог с −Σ журнала по последней сверке; null — ещё не сверялся.
     * `false` — импорт перезакажет отчёт услуг (Маркет мог дописать акт позже).
     */
    journalMatched: boolean('journal_matched'),
    createdAt: moment('created_at').notNull().defaultNow(),
    updatedAt: moment('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('finance_act_services_act_uq').on(t.marketplace, t.telegramUserId, t.actDay)],
);

/**
 * Аномалии журнала месяца (TASK-149). Как и находки сверки — вывод, а не
 * событие: список периода заменяется целиком каждым прогоном (`replacePeriod`).
 * Повтор не плодит дубли: `anomaly_key` уникален на продавца и площадку.
 */
export const financeAnomalies = pgTable(
  'finance_anomalies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketplace: text('marketplace').$type<TFinanceMarketplace>().notNull(),
    telegramUserId: text('telegram_user_id').notNull(),
    periodKey: text('period_key').notNull(),
    kind: text('kind').$type<TAnomalyKind>().notNull(),
    /** Устойчивый ключ (`kind:periodKey:идентичность`) — на нём держится «просмотрено». */
    anomalyKey: text('anomaly_key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    operationIds: jsonb('operation_ids').$type<string[]>().notNull(),
    operationCount: integer('operation_count').notNull(),
    amountKopecks: money('amount_kopecks'),
    sku: text('sku'),
    orderId: text('order_id'),
    threshold: text('threshold').notNull(),
    detail: text('detail').notNull(),
    createdAt: moment('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('finance_anomalies_key_uq').on(t.marketplace, t.telegramUserId, t.anomalyKey),
    index('finance_anomalies_period_idx').on(t.telegramUserId, t.periodKey),
  ],
);

/**
 * Отметки «просмотрено» (TASK-149) — отдельно от списка, иначе перезамена
 * месяца стирала бы их каждую ночь. Отметка действует, пока `fingerprint`
 * совпадает с аномалией (решение `finance_anomaly_review_fingerprint`): новый
 * штраф того же вида или ещё один дубль — снова непросмотрено.
 */
export const financeAnomalyReviews = pgTable(
  'finance_anomaly_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketplace: text('marketplace').$type<TFinanceMarketplace>().notNull(),
    telegramUserId: text('telegram_user_id').notNull(),
    anomalyKey: text('anomaly_key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    reviewedAt: moment('reviewed_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('finance_anomaly_reviews_key_uq').on(t.marketplace, t.telegramUserId, t.anomalyKey),
  ],
);

/**
 * Свои категории расходов продавца (TASK-121). Предустановленные —
 * `EXPENSE_CATEGORIES` в коде, сюда не пишутся. Имя уникально на продавца:
 * две «Аренды» в разбивке читались бы как ошибка отчёта.
 */
export const financeExpenseCategories = pgTable(
  'finance_expense_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    telegramUserId: text('telegram_user_id').notNull(),
    name: text('name').notNull(),
    createdAt: moment('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('finance_expense_categories_user_name_uq').on(t.telegramUserId, t.name)],
);

/**
 * Операционный расход бизнеса (TASK-121, ТЗ п.3): разовый (день) или
 * ежемесячный (день начала, конец по желанию). Не площадочный — площадки и
 * магазина здесь нет: аренда склада одна на все кабинеты продавца.
 *
 * `category` — ключ предустановленной категории или uuid своей; FK нет
 * намеренно, иначе ключи предустановленных пришлось бы заводить строками.
 * Удаление своей категории, на которую есть записи, отказывает сервис.
 */
export const financeExpenses = pgTable(
  'finance_expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    telegramUserId: text('telegram_user_id').notNull(),
    category: text('category').notNull(),
    kind: text('kind').$type<TExpenseKind>().notNull(),
    amountKopecks: money('amount_kopecks').notNull(),
    /** «ГГГГ-ММ-ДД»: у разовой — её день, у ежемесячной — начало. */
    fromDay: text('from_day').notNull(),
    /** «ГГГГ-ММ-ДД» включительно, только у ежемесячной; null — без конца. */
    toDay: text('to_day'),
    note: text('note'),
    createdAt: moment('created_at').notNull().defaultNow(),
    updatedAt: moment('updated_at').notNull().defaultNow(),
  },
  (t) => [index('finance_expenses_user_from_idx').on(t.telegramUserId, t.fromDay)],
);

/**
 * Налоговые настройки продавца (TASK-123): одна строка на продавца, нет строки
 * — действует `DEFAULT_TAX_SETTINGS`. Ставка — сотые доли процента целым
 * (600 = 6 %), без float. Площадки нет: налог считается с бизнеса целиком.
 */
export const financeTaxSettings = pgTable('finance_tax_settings', {
  telegramUserId: text('telegram_user_id').primaryKey(),
  regime: text('regime').$type<TTaxRegime>().notNull(),
  rateBasisPoints: integer('rate_basis_points').notNull(),
  recognition: text('recognition').$type<TTaxRecognition>().notNull(),
  /**
   * Есть ли у ИП работники (TASK-146): от этого зависит, на какую долю взносы
   * уменьшают налог УСН «Доходы» — весь налог или доля из `finance_tax_years`.
   */
  hasStaff: boolean('has_staff').notNull().default(false),
  updatedAt: moment('updated_at').notNull().defaultNow(),
});

/**
 * Закупка партии (TASK-122): поставщик, день оплаты, сумма и необязательные
 * позиции. Движение денег, а НЕ расход P&L — себестоимость проданного P&L
 * берёт по продажам, и закупка там списала бы товар второй раз. Площадки нет:
 * партия покупается на бизнес, а не на кабинет.
 */
export const financePurchases = pgTable(
  'finance_purchases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    telegramUserId: text('telegram_user_id').notNull(),
    supplier: text('supplier').notNull(),
    /** «ГГГГ-ММ-ДД» — день оплаты, по нему закупка ложится в ДДС. */
    paidDay: text('paid_day').notNull(),
    amountKopecks: money('amount_kopecks').notNull(),
    /** Позиции — справка; null — не указаны (решение `purchase_lines_optional`). */
    lines: jsonb('lines').$type<IPurchaseLine[] | null>(),
    note: text('note'),
    createdAt: moment('created_at').notNull().defaultNow(),
    updatedAt: moment('updated_at').notNull().defaultNow(),
  },
  (t) => [index('finance_purchases_user_paid_idx').on(t.telegramUserId, t.paidDay)],
);

/**
 * Уплаченный налог (TASK-122, решение `cashflow_tax_paid_manual`): продавец
 * вносит его руками. Начисленный налог (`taxOf`) — вопрос P&L; в ДДС идёт
 * только то, что действительно ушло, — авансы УСН платят раз в квартал.
 */
export const financeTaxPayments = pgTable(
  'finance_tax_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    telegramUserId: text('telegram_user_id').notNull(),
    paidDay: text('paid_day').notNull(),
    amountKopecks: money('amount_kopecks').notNull(),
    note: text('note'),
    createdAt: moment('created_at').notNull().defaultNow(),
    updatedAt: moment('updated_at').notNull().defaultNow(),
  },
  (t) => [index('finance_tax_payments_user_paid_idx').on(t.telegramUserId, t.paidDay)],
);

/**
 * Параметры налогового года (TASK-146, решение `tax_year_params_global_admin`):
 * лимит УСН, порог НДС, взносы, предельные ставки — ДАННЫЕ, одна строка на год
 * для всех продавцов. Миграция заводит 2025–2027, дальше правит админ через
 * `/api/finance/tax-years` без деплоя. null — значение не задано, а не ноль.
 */
export const financeTaxYears = pgTable('finance_tax_years', {
  year: integer('year').primaryKey(),
  usnIncomeLimitKopecks: money('usn_income_limit_kopecks'),
  vatThresholdKopecks: money('vat_threshold_kopecks'),
  insuranceFixedKopecks: money('insurance_fixed_kopecks'),
  insuranceExtraCapKopecks: money('insurance_extra_cap_kopecks'),
  reductionLimitWithStaffBasisPoints: integer('reduction_limit_with_staff_bp'),
  maxRateUsnIncomeBasisPoints: integer('max_rate_usn_income_bp'),
  maxRateUsnIncomeMinusExpensesBasisPoints: integer('max_rate_usn_income_minus_expenses_bp'),
  sourceNote: text('source_note'),
  updatedAt: moment('updated_at').notNull().defaultNow(),
});

/**
 * Уменьшения налога УСН (TASK-146): страховые взносы и прочее, ручной ввод.
 * День уплаты решает, налог какого отчётного периода уменьшается.
 */
export const financeTaxReductions = pgTable(
  'finance_tax_reductions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    telegramUserId: text('telegram_user_id').notNull(),
    paidDay: text('paid_day').notNull(),
    kind: text('kind').$type<TTaxReductionKind>().notNull(),
    amountKopecks: money('amount_kopecks').notNull(),
    note: text('note'),
    createdAt: moment('created_at').notNull().defaultNow(),
    updatedAt: moment('updated_at').notNull().defaultNow(),
  },
  (t) => [index('finance_tax_reductions_user_paid_idx').on(t.telegramUserId, t.paidDay)],
);

/**
 * Ручная сверка отчётного периода с бухгалтерией (TASK-146): что насчитал
 * бухгалтер и отметка «сверено». Одна строка на продавца, год и период.
 */
export const financeTaxReconciliations = pgTable(
  'finance_tax_reconciliations',
  {
    telegramUserId: text('telegram_user_id').notNull(),
    year: integer('year').notNull(),
    period: text('period').$type<TTaxYearPeriod>().notNull(),
    accountantIncomeKopecks: money('accountant_income_kopecks'),
    accountantTaxKopecks: money('accountant_tax_kopecks'),
    checked: boolean('checked').notNull().default(false),
    note: text('note'),
    checkedAt: moment('checked_at'),
    updatedAt: moment('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('finance_tax_reconciliations_key').on(t.telegramUserId, t.year, t.period)],
);

export const financeSchema = {
  financeDocuments,
  financeOperations,
  financeCorrections,
  financePeriods,
  financeDiscrepancies,
  financeActServices,
  financeAnomalies,
  financeAnomalyReviews,
  financeExpenseCategories,
  financeExpenses,
  financeTaxSettings,
  financePurchases,
  financeTaxPayments,
  financeTaxYears,
  financeTaxReductions,
  financeTaxReconciliations,
};
