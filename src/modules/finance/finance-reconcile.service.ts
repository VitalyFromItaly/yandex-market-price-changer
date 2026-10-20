import type { IFinancePeriod } from './finance-period';
import type { TFinanceReconcileState } from './finance-period-status';
import type { IReconcileAct } from './finance-reconcile';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { YandexMarketDocument } from '../../database/schemas/yandex-market.schema';
import type { ICalendarDate } from '../yandex/reports/moscow-day';
import type { YandexApiClient } from '../yandex/yandex-api.client';

import { Injectable, Logger } from '@nestjs/common';

import { FinanceActServicesRepository } from '../../database/postgres/repositories/finance-act-services.repository';
import { FinanceDiscrepancyRepository } from '../../database/postgres/repositories/finance-discrepancy.repository';
import { FinanceDocumentRepository } from '../../database/postgres/repositories/finance-document.repository';
import { FinanceOperationRepository } from '../../database/postgres/repositories/finance-operation.repository';
import { YandexMarketService } from '../../database/services/yandex-market.service';
import { compareDates, shiftDays } from '../yandex/reports/moscow-day';
import { statsUpdateParams } from '../yandex/reports/stats-orders';
import { YandexClientFactory } from '../yandex/yandex-client.factory';

import {
  financePeriodKey,
  financeToday,
  monthPeriod,
  YM_NETTING_REPORT_TYPE,
} from './finance-period';
import { isPeriodClosed } from './finance-period-status';
import { actMatches, countByKind, orderIdsToLookup, reconcile } from './finance-reconcile';

/**
 * Статусы архива заказов, которые значат «выкуплен». PARTIALLY_DELIVERED —
 * тоже: часть выкуплена, продажа по ней обязана быть.
 */
export const RECONCILE_DELIVERED_STATS_STATUSES = ['DELIVERED', 'PARTIALLY_DELIVERED'];

/** Сколько id в одном запросе `orders`: лимит страницы архива — 200. */
export const ORDER_LOOKUP_BATCH = 200;

/** Окно архива заказов — как у отчётов (`MAX_WINDOW_DAYS`). */
const WINDOW_DAYS = 30;

/**
 * Окно журнала вокруг месяца: строки, выплаченные в M, начислены и за два
 * месяца до него (в отчёте 09-2026 — с 16.07), а продажа по заказу,
 * выкупленному в M, — до конца M+1.
 */
export const RECONCILE_ACCRUED_BEFORE_DAYS = 120;
const ACCRUED_AFTER_DAYS = 62;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface IFinanceReconcileOutcome {
  state: TFinanceReconcileState;
}

/**
 * Заказы площадки для сверки (TASK-132). Правило сверки одно (`reconcile`),
 * а «что выкуплено в месяце» и «существует ли заказ» каждая площадка узнаёт
 * по-своему: ЯМ — архив `stats/orders` по магазинам кабинета, Ozon — список
 * отправлений. Источник приносит площадка (у Ozon — вместе с журналом), чтобы
 * финмодуль не зависел от её модуля.
 */
export interface IReconcileOrders {
  /** Заказы, выкупленные в периоде, — по правилу площадки. */
  deliveredIn(period: IFinancePeriod): Promise<Set<string>>;
  /** Какие из `orderIds` площадка знает. */
  existing(orderIds: readonly string[], period: IFinancePeriod): Promise<Set<string>>;
}

/** Чей журнал сверяем: площадка и тип её отчёта (ключ периода, соседи). */
export interface IReconcileScope {
  marketplace: TFinanceMarketplace;
  reportType: string;
}

const YM_RECONCILE_SCOPE: IReconcileScope = {
  marketplace: 'ym',
  reportType: YM_NETTING_REPORT_TYPE,
};

const toCalendar = (iso: string): ICalendarDate => {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
};

/** Месяц ±1 — соседи для проверки «загружен ли их отчёт». */
function neighbourMonth(period: IFinancePeriod, shift: -1 | 1): IFinancePeriod {
  const { year, month } = toCalendar(period.from);
  const index = year * 12 + (month - 1) + shift;
  return monthPeriod(Math.floor(index / 12), (index % 12) + 1);
}

/** Период → окна ≤ 30 календарных дней (архив ЯМ, отправления Ozon). */
export function reconcileWindows(
  period: IFinancePeriod,
): { from: ICalendarDate; to: ICalendarDate }[] {
  const end = toCalendar(period.to);
  const windows: { from: ICalendarDate; to: ICalendarDate }[] = [];
  let from = toCalendar(period.from);
  while (compareDates(from, end) <= 0) {
    const last = shiftDays(from, WINDOW_DAYS - 1);
    const to = compareDates(last, end) > 0 ? end : last;
    windows.push({ from, to });
    from = shiftDays(to, 1);
  }
  return windows;
}

const orderIdOf = (raw: unknown): string | null => {
  const id = (raw as { id?: unknown } | null)?.id;
  return id === undefined || id === null ? null : String(id);
};

/**
 * Сверка журнала ЯМ закрытого месяца с заказами и выплатами (TASK-113).
 * Правило — чистая `reconcile`, здесь — сбор входа и запись находок.
 *
 * Заказы — из архива Partner API `stats/orders` по ВСЕМ магазинам кабинета:
 * журнал бизнесовый, заказ FBY лежит в другой кампании, чем FBS. Флаг
 * deep_history здесь не участвует (решение `finance_reconcile_orders_source`):
 * он защищает числа в отчётах продавца, а сверке нужны только id и статус.
 */
@Injectable()
export class FinanceReconcileService {
  private readonly logger = new Logger(FinanceReconcileService.name);

  constructor(
    private readonly stores: YandexMarketService,
    private readonly clients: YandexClientFactory,
    private readonly documents: FinanceDocumentRepository,
    private readonly operations: FinanceOperationRepository,
    private readonly discrepancies: FinanceDiscrepancyRepository,
    private readonly actServices: FinanceActServicesRepository,
  ) {}

  /**
   * Сверить месяц и заменить его находки. Незакрытый месяц — `skipped` без
   * единого запроса (решение `finance_reconcile_closed_only`). Ошибки
   * пробрасываются: что делать со сбоем, решает импорт.
   */
  async reconcilePeriod(
    telegramUserId: string,
    period: IFinancePeriod,
    now: Date = new Date(),
  ): Promise<TFinanceReconcileState> {
    if (!isPeriodClosed(period.to, financeToday(now))) return { state: 'skipped' };

    const store = await this.stores.findByTelegramUser(telegramUserId);
    if (!store?.business_id) {
      throw new Error(`Сверка финансов: у продавца ${telegramUserId} не подключён магазин`);
    }
    let clients: Promise<YandexApiClient[]> | null = null;
    const campaigns = () => (clients ??= this.campaignClients(store));
    const orders: IReconcileOrders = {
      deliveredIn: async (p) => await this.deliveredIn(await campaigns(), p),
      existing: async (ids) => await this.existing(await campaigns(), ids),
    };
    return await this.reconcileMarketplace(YM_RECONCILE_SCOPE, telegramUserId, period, orders, {
      acts: true,
      now,
    });
  }

  /**
   * Сверка закрытого месяца любой площадки (TASK-132): журнал, соседи, заказы
   * из источника площадки → чистая `reconcile` → находки периода. Акты
   * (`acts: true`) — только у ЯМ: у Ozon нет ни актов, ни отчёта услуг.
   * Ошибки пробрасываются, как у `reconcilePeriod`.
   */
  async reconcileMarketplace(
    scope: IReconcileScope,
    telegramUserId: string,
    period: IFinancePeriod,
    orders: IReconcileOrders,
    options: { acts: boolean; now?: Date },
  ): Promise<TFinanceReconcileState> {
    const now = options.now ?? new Date();
    if (!isPeriodClosed(period.to, financeToday(now))) return { state: 'skipped' };
    const { marketplace } = scope;
    const periodKey = financePeriodKey(scope.reportType, period);

    const fromMs = Date.parse(`${period.from}T00:00:00+03:00`);
    const toMs = Date.parse(`${period.to}T23:59:59+03:00`);
    const [operations, prev, next, acts] = await Promise.all([
      this.operations.liveForReconcile(
        telegramUserId,
        new Date(fromMs - RECONCILE_ACCRUED_BEFORE_DAYS * DAY_MS),
        new Date(toMs + ACCRUED_AFTER_DAYS * DAY_MS),
        marketplace,
      ),
      this.isImported(scope, telegramUserId, neighbourMonth(period, -1)),
      this.isImported(scope, telegramUserId, neighbourMonth(period, 1)),
      options.acts ? this.actsOf(telegramUserId, periodKey) : null,
    ]);
    const neighbors = { prev, next };

    let deliveredOrderIds = new Set<string>();
    let existingOrderIds = new Set<string>();
    if (prev && next) {
      deliveredOrderIds = await orders.deliveredIn(period);
      const lookup = orderIdsToLookup({ operations, periodKey, deliveredOrderIds });
      existingOrderIds = lookup.length ? await orders.existing(lookup, period) : new Set();
    }

    const result = reconcile({
      period,
      periodKey,
      operations,
      deliveredOrderIds,
      existingOrderIds,
      neighbors,
      ...(acts ? { acts } : {}),
    });
    await this.discrepancies.replacePeriod(
      { marketplace, telegramUserId, periodKey },
      result.findings,
    );
    // Исход по актам — импорту: не сошедшийся акт он перезакажет (TASK-158).
    if (acts) await this.actServices.markMatched(telegramUserId, actMatches(acts));

    const counts = countByKind(result.findings);
    this.logger.log(
      `Сверка ${marketplace} ${telegramUserId} ${period.from}…${period.to}: ` +
        (result.unchecked ? `неполно (${result.unchecked}), ` : '') +
        (acts ? `актов ${acts.length}, ` : '') +
        `выкуплено ${deliveredOrderIds.size}, находок ${result.findings.length} ` +
        JSON.stringify(counts),
    );

    const discrepancies = result.findings.length;
    return result.unchecked
      ? { state: 'unchecked', discrepancies, reason: result.unchecked }
      : { state: 'checked', discrepancies };
  }

  /** Акты периода: Σ журнала по всему журналу и итог отчёта услуг (TASK-158). */
  private async actsOf(telegramUserId: string, periodKey: string): Promise<IReconcileAct[]> {
    const days = await this.operations.actDaysOfPeriod(telegramUserId, periodKey);
    if (!days.length) return [];
    const [journal, services] = await Promise.all([
      this.operations.actJournalSums(telegramUserId, days),
      this.actServices.byDays(telegramUserId, days),
    ]);
    return days.map((actDay) => ({
      actDay,
      journal: journal.get(actDay) ?? { kopecks: 0, operationCount: 0, operationIds: [] },
      servicesKopecks: services.get(actDay)?.totalKopecks ?? null,
    }));
  }

  private async isImported(
    scope: IReconcileScope,
    telegramUserId: string,
    period: IFinancePeriod,
  ): Promise<boolean> {
    const latest = await this.documents.latest({
      marketplace: scope.marketplace,
      telegramUserId,
      reportType: scope.reportType,
      periodFrom: period.from,
      periodTo: period.to,
    });
    return latest?.status === 'imported';
  }

  /**
   * Клиенты всех магазинов кабинета: кэш `stores` по business_id, при промахе —
   * живой `listStores`. Активный магазин — всегда, даже если кэш его не знает.
   */
  private async campaignClients(store: YandexMarketDocument): Promise<YandexApiClient[]> {
    const businessId = String(store.business_id);
    let campaigns = (store.stores ?? [])
      .filter((s) => String(s.businessId) === businessId)
      .map((s) => String(s.campaignId));
    if (!campaigns.length) {
      const live = await this.clients.forStore(store).listStores();
      campaigns = live
        .filter((s) => String(s.businessId) === businessId)
        .map((s) => String(s.campaignId));
    }
    const unique = [...new Set([String(store.campaign_id), ...campaigns])];
    return unique.map((campaignId) =>
      this.clients.forTenant({ token: store.token, campaignId, businessId }),
    );
  }

  /** Заказы, выкупленные в месяце (дата обновления статуса), по всем магазинам. */
  private async deliveredIn(
    clients: readonly YandexApiClient[],
    period: IFinancePeriod,
  ): Promise<Set<string>> {
    const ids = new Set<string>();
    for (const client of clients) {
      for (const window of reconcileWindows(period)) {
        for await (const page of client.iterateOrdersStats({
          statuses: RECONCILE_DELIVERED_STATS_STATUSES,
          ...statsUpdateParams(window),
        })) {
          for (const raw of page) {
            const id = orderIdOf(raw);
            if (id) ids.add(id);
          }
        }
      }
    }
    return ids;
  }

  /**
   * Какие из заказов Маркет знает — по каждому магазину, пока не найдены все.
   * Нечисловой id не спрашивается: Маркету его не послать, и он останется
   * «не найден» — то есть расхождением, а не тихим пропуском.
   */
  private async existing(
    clients: readonly YandexApiClient[],
    orderIds: readonly string[],
  ): Promise<Set<string>> {
    const found = new Set<string>();
    let pending = orderIds.filter((id) => /^\d+$/.test(id));
    for (const client of clients) {
      if (!pending.length) break;
      for (let i = 0; i < pending.length; i += ORDER_LOOKUP_BATCH) {
        const batch = pending.slice(i, i + ORDER_LOOKUP_BATCH).map(Number);
        for await (const page of client.iterateOrdersStats({ orders: batch })) {
          for (const raw of page) {
            const id = orderIdOf(raw);
            if (id) found.add(id);
          }
        }
      }
      pending = pending.filter((id) => !found.has(id));
    }
    return found;
  }
}
