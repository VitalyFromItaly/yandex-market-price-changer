import type { IConnectionCheck } from './marketplace-connections.domain';
import type { TMarketplace } from '../../shared/marketplace';
import type { TOrderStage } from '../../shared/order-stage';
import type { TFinanceImportResult } from '../finance/finance-import.service';
import type { IFinancePeriod } from '../finance/finance-period';
import type { IProductCatalogRow } from '../products/product.domain';
import type { IReportPeriod } from '../yandex/reports/report-period';

/**
 * Адаптер площадки (TASK-127, TASK-162) — набор ВОЗМОЖНОСТЕЙ, а не одна сессия
 * из всех методов разом. Площадка регистрирует ровно то, что умеет: у ЯМ — всё,
 * у Ozon — подключение, каталог, остатки (TASK-163) и заказы (TASK-130), у WB —
 * подключение. Монолитная сессия заставила
 * бы Ozon либо не регистрироваться вовсе (и «Подключения» жили бы сбоку от
 * реестра switch-ем), либо бросать «не реализовано» из `importFinance` —
 * ловушка для ночной загрузки (решение `ozon_adapter_after_finance`).
 * Нет поля — нет возможности, и реестр отвечает на это внятным отказом.
 *
 * Специфика одной площадки (карантин, отзывы, FBY, отчёты Маркета) сюда не
 * входит: она живёт разделами своей площадки (`marketplace_adapter_unification`).
 */
export type TMarketplaceCapability =
  | 'connection'
  | 'finance'
  | 'orders'
  | 'catalog'
  | 'stocks'
  | 'stockWrite';

/**
 * Карточка площадки — НАША сущность (TASK-163), выведенная по ЯМ и Ozon: та
 * самая строка, которую принимает `ProductMatchService.syncCatalog`. Поэтому
 * потребителю каталога не нужен маппер под площадку — форму ответа площадки
 * знает только её адаптер.
 */
export interface IMarketplaceProduct extends IProductCatalogRow {
  /** Карточка в архиве площадки (Ozon); у ЯМ признака нет. */
  archived?: boolean;
}

/**
 * Где лежит товар. `seller` — склад продавца (FBS/DBS/Express ЯМ, FBS Ozon),
 * `marketplace` — склад площадки (FBY ЯМ, FBO Ozon). Это разные склады, и
 * суммы между ними нет намеренно: правило FBY read-only — число на чужом складе
 * двигают приёмка и продажи, а не продавец.
 */
export type TStockLocation = 'seller' | 'marketplace';

export interface IStockAmount {
  /** Доступно к продаже. */
  available: number;
  /** Зарезервировано под заказы сверх `available`; null — площадка не сообщает (ЯМ). */
  reserved: number | null;
}

/** Почему остатков нет. Значения — те же, что у отчёта остатков FBY. */
export type TStockUnavailable = 'rate_limit' | 'generic';

/** Остатки по артикулам — НАША сущность (TASK-163), места хранения раздельно. */
export interface IMarketplaceStockLevels {
  /** Момент съёмки; null — остатков нет. */
  takenAt: Date | null;
  byLocation: Partial<Record<TStockLocation, Record<string, IStockAmount>>>;
  /** Модель магазина ЯМ (FBY, FBS…); у площадок без модели магазина — null. */
  placement: string | null;
  /** Остатков нет — причина; `byLocation` тогда пуст. */
  error?: TStockUnavailable;
}

/** Позиция заказа площадки. */
export interface IMarketplaceOrderItem {
  /** Артикул продавца (ЯМ `offerId`, Ozon `offer_id`) — ключ товаров. */
  sku: string;
  name?: string;
  count: number;
  /** Цена за штуку в рублях, как её сообщает площадка; null — нет или не в рублях. */
  price: number | null;
}

/**
 * Заказ площадки — НАША сущность (TASK-130), выведенная по ЯМ и отправлениям
 * Ozon. Строка — то, что площадка отгружает одним номером: у ЯМ это заказ, у
 * Ozon — отправление (заказ покупателя Ozon делится на отправления по складам,
 * и статус, состав и схема у них свои).
 */
export interface IMarketplaceOrder {
  marketplace: TMarketplace;
  /** Номер строки на площадке: id заказа ЯМ, `posting_number` Ozon. */
  id: string;
  /** Заказ покупателя: у ЯМ совпадает с `id`, у Ozon — `order_number`. */
  orderNumber: string;
  /** Схема (FBS, FBO, FBY, DBS…) прописными; null — площадка её не сообщила. */
  scheme: string | null;
  /** Этап из общего набора ТЗ п.11. */
  stage: TOrderStage;
  /** Статус и подстатус как их прислала площадка — для разбора спорных случаев. */
  status: string;
  substatus: string | null;
  /** День оформления `ГГГГ-ММ-ДД` по Москве; null — даты нет. */
  createdDay: string | null;
  items: IMarketplaceOrderItem[];
  /**
   * Продажи продавца в рублях: у ЯМ — `orderTotals().sales` (с субсидиями
   * Маркета), у Ozon — Σ цена × штуки. null — цена хоть одной позиции
   * неизвестна: ноль читался бы как бесплатный заказ.
   */
  sales: number | null;
}

/**
 * Итог импорта финансов — общий у площадок: Ozon (TASK-131) пишет журнал тем
 * же путём версии, что ЯМ, и отвечает тем же `TFinanceImportResult`.
 */
export type TMarketplaceOrder = IMarketplaceOrder;
export type TMarketplaceProduct = IMarketplaceProduct;
export type TMarketplaceStocks = IMarketplaceStockLevels;
export type TMarketplaceFinanceImport = TFinanceImportResult;

export interface IMarketplaceOrders {
  orders: TMarketplaceOrder[];
  cancelled: TMarketplaceOrder[];
}

/**
 * Ссылка на подключение, а не креды — довод «payload без токена»: адаптер сам
 * перечитывает ключи, и они не путешествуют по вызовам, очередям и журналу.
 * `campaignId` сужает ЯМ до одного магазина (как `scopeStore` в CRM); без него
 * — активный магазин бота.
 */
export interface IMarketplaceConnectionRef {
  telegramUserId: string;
  marketplace: TMarketplace;
  campaignId?: string;
}

/** Кто спрашивает — для журнала ошибок площадки. Ключ сюда не попадает никогда. */
export interface IMarketplaceCallOrigin {
  source: 'crm';
  context: string;
}

/**
 * Подключение ключа — часть контракта (TASK-162): «Подключения» спрашивают
 * любую площадку одинаково.
 */
export interface IMarketplaceConnector {
  /** Поле кредов, по которому печатается маска ключа на «Подключениях». */
  readonly secretField: string;
  /**
   * Записанный ключ ещё раз спрашивает площадка. Ключ не меняется ни в одном
   * исходе; недоступность статус подключения не трогает. null — не подключено.
   */
  check(telegramUserId: string, origin: IMarketplaceCallOrigin): Promise<IConnectionCheck | null>;
}

export interface IMarketplaceFinance {
  /** Загрузить финансовый журнал периода в Postgres. */
  importFinance(
    ref: IMarketplaceConnectionRef,
    period: IFinancePeriod,
  ): Promise<TMarketplaceFinanceImport>;
}

export interface IMarketplaceOrderSource {
  /**
   * Оформленные за период заказы (отменённые — отдельно, в деньги не идут).
   * «Всего» (без границ) — то, что площадка отдаёт без дат: у ЯМ это его
   * неявные 30 дней, у Ozon — последние 30 дней.
   */
  listOrders(
    ref: IMarketplaceConnectionRef,
    period: IReportPeriod,
    now?: Date,
  ): Promise<IMarketplaceOrders>;
}

export interface IMarketplaceCatalog {
  /** Каталог карточек площадки — только чтение. */
  listProducts(ref: IMarketplaceConnectionRef): Promise<TMarketplaceProduct[]>;
}

export interface IMarketplaceStocks {
  /** Остатки по артикулам — только чтение. */
  listStocks(ref: IMarketplaceConnectionRef, now?: Date): Promise<TMarketplaceStocks>;
}

/** Склад продавца, на который пишется остаток площадки. */
export interface IStockWriteWarehouse {
  id: string;
  name: string;
}

/**
 * Куда писать остаток площадки (TASK-175, решение `stock_push_single_fbs_warehouse`):
 * ровно один склад продавца, и он FBS — `ok`; иначе писать некуда (`none`) или
 * неоднозначно (`several`) — план блокирует площадку, ничего не пишется.
 */
export type TStockWriteTarget =
  | {
      kind: 'ok';
      warehouse: IStockWriteWarehouse;
      /** Артикулы, которые `writeStocks` не отправит, с причиной (WB — размеры). */
      unwritable?: { sku: string; reason: string }[];
    }
  | { kind: 'none' }
  | { kind: 'several'; names: string[] };

/** Позиция записи: артикул площадки и новое количество. */
export interface IStockWriteUpdate {
  sku: string;
  count: number;
}

/**
 * Итог записи на площадку. `skipReason` — запись не ушла вовсе (env выключен или
 * склад уже не тот); `skipped` — позиции, которые площадке не отправлялись
 * (у WB — карточка с несколькими штрихкодами); `errors` — отказы площадки.
 */
export interface IMarketplaceStockWriteResult {
  written: number;
  errors: { batch: number; message: string }[];
  skipped: { sku: string; reason: string }[];
  skipReason?: 'write-disabled' | 'placement';
}

/**
 * ЗАПИСЬ остатков на склад продавца (TASK-175) — Ozon и WB. У ЯМ своей записи
 * через реестр нет: он пишет `StockSyncService.writeStocks` (модель кампании).
 *
 * `writeStocks` — единственная функция записи площадки, и все барьеры внутри неё:
 * `STOCK_WRITE_ENABLED`, повторная проверка склада, целые неотрицательные
 * количества. Повторов на записи нет.
 */
export interface IMarketplaceStockWriter {
  /** Склад записи по правилу «ровно один FBS» — только чтение. */
  writeTarget(ref: IMarketplaceConnectionRef): Promise<TStockWriteTarget>;
  writeStocks(
    ref: IMarketplaceConnectionRef,
    warehouseId: string,
    updates: readonly IStockWriteUpdate[],
  ): Promise<IMarketplaceStockWriteResult>;
}

/** Возможность → её интерфейс. `Record`, чтобы новая возможность не забылась в реестре. */
export interface IMarketplaceCapabilities {
  connection: IMarketplaceConnector;
  finance: IMarketplaceFinance;
  orders: IMarketplaceOrderSource;
  catalog: IMarketplaceCatalog;
  stocks: IMarketplaceStocks;
  stockWrite: IMarketplaceStockWriter;
}

export const MARKETPLACE_CAPABILITIES = Object.keys({
  connection: true,
  finance: true,
  orders: true,
  catalog: true,
  stocks: true,
  stockWrite: true,
} satisfies Record<TMarketplaceCapability, true>) as TMarketplaceCapability[];

/** Часть адаптера площадки: несколько частей одной площадки реестр складывает. */
export type IMarketplaceAdapter = {
  readonly marketplace: TMarketplace;
} & Partial<IMarketplaceCapabilities>;

/**
 * Площадка не подключена у продавца или не умеет того, о чём спросили.
 * Отдельный класс, чтобы вызывающий отличал «нечего спрашивать» от сбоя площадки.
 */
export class MarketplaceNotConnectedError extends Error {
  constructor(
    readonly marketplace: TMarketplace,
    readonly telegramUserId: string,
    reason: 'no-adapter' | 'no-credentials',
    capability?: TMarketplaceCapability,
  ) {
    super(
      reason === 'no-adapter'
        ? `Площадка ${marketplace}: возможности ${capability ?? '?'} ещё нет`
        : `Площадка ${marketplace}: у продавца ${telegramUserId} не подключена`,
    );
    this.name = 'MarketplaceNotConnectedError';
  }
}
