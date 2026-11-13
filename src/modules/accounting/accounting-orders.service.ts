import type { TReturnCondition } from './accounting-lots.domain';
import type {
  IAccountingOrderLineInput,
  IAccountingOrderLineValue,
  IOrderLinesWindow,
  IOzonPostingRaw,
  IWbOrderRowRaw,
  IWbSaleRowRaw,
  IYmOrderRaw,
} from './accounting-order-lines.domain';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { YandexMarketDocument } from '../../database/schemas/yandex-market.schema';
import type { IMarketplaceRawOrderLine } from '../marketplaces/marketplace-adapter';
import type { IReturnRecord, YandexApiClient } from '../yandex/yandex-api.client';

import { Injectable } from '@nestjs/common';

import { AccountingOrderLineRepository } from '../../database/postgres/repositories/accounting-order-line.repository';
import { YandexMarketService } from '../../database/services/yandex-market.service';
import { syncErrorText } from '../finance/finance-sync';
import { MarketplaceNotConnectedError } from '../marketplaces/marketplace-adapter';
import { MarketplaceRegistry } from '../marketplaces/marketplace-registry.service';
import { orderDayIso } from '../yandex/reports/order-day';
import { YandexClientFactory } from '../yandex/yandex-client.factory';

import {
  orderLinesDue,
  orderLinesWindow,
  ozonOrderLines,
  ozonOrderLinesWindow,
  wbOrderLine,
  ymOrderLines,
  ymReturnConditions,
} from './accounting-order-lines.domain';

/** Сколько строк копить до записи: позиции одного заказа не рвутся между пачками. */
const FLUSH_LINES = 500;

export interface IAccountingOrdersSyncResult {
  outcome: 'imported' | 'unchanged' | 'not-connected';
  /** Окно опроса; нет при not-connected. */
  window?: { from: string; to: string };
  /** Магазины ЯМ; у Ozon/WB — 0. */
  campaigns: number;
  /** Заказы ЯМ, отправления Ozon, строки «Статистики» WB. */
  orders: number;
  seen: number;
  created: number;
  changed: number;
}

/** Итог площадки в проходе: сбой и «рано» в состояние опроса не пишут «успех». */
export type TAccountingOrdersMarketplaceResult =
  | IAccountingOrdersSyncResult
  | { outcome: 'failed'; error: string }
  | { outcome: 'skipped' };

export interface IAccountingOrdersSyncReport {
  results: Partial<Record<TFinanceMarketplace, TAccountingOrdersMarketplaceResult>>;
}

export interface IAccountingOrdersSyncOptions {
  now?: Date;
  /** Площадки прохода (процессор — те, что положены продавцу). По умолчанию — ЯМ. */
  marketplaces?: readonly TFinanceMarketplace[];
  /** Окно первого опроса в днях (скрипт); дальше — от курсора последнего успеха. */
  firstDays?: number;
  /** Игнорировать курсор и интервал площадки, взять `firstDays` дней (скрипт `--days`). */
  ignoreCursor?: boolean;
}

/** Сбой площадок прохода: остальные уже записаны, ошибку видит процессор. */
export class AccountingOrdersSyncError extends Error {
  constructor(
    readonly report: IAccountingOrdersSyncReport,
    readonly causes: Partial<Record<TFinanceMarketplace, unknown>>,
  ) {
    super(
      `Снимок строк заказов: сбой ${Object.entries(report.results)
        .filter(([, result]) => result.outcome === 'failed')
        .map(([marketplace, result]) => `${marketplace} — ${(result as { error: string }).error}`)
        .join('; ')}`,
    );
    this.name = 'AccountingOrdersSyncError';
  }
}

const EMPTY = { campaigns: 0, orders: 0, seen: 0, created: 0, changed: 0 };

/**
 * Снимок строк заказов «Финучёта»: ЯМ (TASK-210), Ozon и WB (TASK-211).
 *
 * ЯМ — токен из Mongo на каждый прогон (в payload очереди его нет); магазины —
 * все кампании того же кабинета (как сверка, `campaignClients`), по очереди:
 * квоту getOrders (10 000 в час) один продавец раз в 15 минут не съест, а
 * повторы 420/429 уже в клиенте.
 *
 * Ozon и WB — сырьё через реестр (`orderLines`): клиенты площадок «Финучёт» не
 * импортирует. Повторы и выдержка «Статистики» WB — в их клиентах. Не чаще
 * `ORDER_LINES_MIN_INTERVAL_MS` на площадку.
 *
 * Площадки независимы: сбой одной пишет «сбой» в её состояние (курсор не
 * двигается — следующий опрос возьмёт то же окно), остальные идут дальше, а
 * после прохода бросается `AccountingOrdersSyncError` — её видит процессор.
 */
@Injectable()
export class AccountingOrdersService {
  constructor(
    private readonly stores: YandexMarketService,
    private readonly clients: YandexClientFactory,
    private readonly lines: AccountingOrderLineRepository,
    private readonly registry: MarketplaceRegistry,
  ) {}

  async syncUser(
    telegramUserId: string,
    options: IAccountingOrdersSyncOptions = {},
  ): Promise<IAccountingOrdersSyncReport> {
    const now = options.now ?? new Date();
    const report: IAccountingOrdersSyncReport = { results: {} };
    const causes: Partial<Record<TFinanceMarketplace, unknown>> = {};
    const marketplaces = new Set<TFinanceMarketplace>(options.marketplaces ?? ['ym']);
    for (const marketplace of marketplaces) {
      try {
        if (!options.ignoreCursor && marketplace !== 'ym') {
          const state = await this.lines.syncState(telegramUserId, marketplace);
          if (!orderLinesDue(marketplace, state?.lastAttemptAt ?? null, now)) {
            report.results[marketplace] = { outcome: 'skipped' };
            continue;
          }
        }
        report.results[marketplace] =
          marketplace === 'ym'
            ? await this.syncYm(telegramUserId, now, options)
            : await this.syncRegistry(telegramUserId, marketplace, now, options);
      } catch (error) {
        const text = syncErrorText(error);
        await this.lines
          .recordFailure({ telegramUserId, marketplace, at: now, error: text })
          .catch(() => undefined);
        report.results[marketplace] = { outcome: 'failed', error: text };
        causes[marketplace] = error;
      }
    }
    if (Object.keys(causes).length) throw new AccountingOrdersSyncError(report, causes);
    return report;
  }

  private async syncYm(
    telegramUserId: string,
    now: Date,
    options: IAccountingOrdersSyncOptions,
  ): Promise<IAccountingOrdersSyncResult> {
    const store = await this.stores.findByTelegramUser(telegramUserId);
    if (!store?.token || !store.campaign_id || !store.business_id) {
      return await this.notConnected(telegramUserId, 'ym', now);
    }

    const window = await this.cursorWindow(telegramUserId, 'ym', now, options);
    const query = {
      updatedAtFrom: window.from.toISOString(),
      updatedAtTo: window.to.toISOString(),
    };
    const totals = { ...EMPTY };
    const clients = await this.campaignClients(store);
    totals.campaigns = clients.length;
    const returnsQuery = {
      fromDate: orderDayIso(window.from.toISOString()),
      toDate: orderDayIso(window.to.toISOString()),
    };
    for (const client of clients) {
      const writer = this.writer(telegramUserId, now, totals);
      // Сначала возвраты окна (TASK-238): их состояние ложится на строки заказа.
      const returns: IReturnRecord[] = [];
      for await (const page of client.iterateReturns(returnsQuery)) returns.push(...page);
      const conditions = ymReturnConditions(returns);
      const seen = new Set<string>();
      for await (const page of client.iterateOrders(query)) {
        const orders = page as IYmOrderRaw[];
        const lines = orders.flatMap((order) => {
          const orderId = String(order?.id ?? '');
          seen.add(orderId);
          return ymOrderLines(order, client.campaignId, conditions.get(orderId));
        });
        totals.orders += orders.length;
        await writer.push(await this.keepReturnConditions(telegramUserId, lines));
      }
      const orphans = [...conditions.keys()].filter((orderId) => !seen.has(orderId));
      await writer.push(await this.restampReturns(telegramUserId, orphans, conditions));
      await writer.flush();
    }
    return await this.recordDone(telegramUserId, 'ym', now, window, totals);
  }

  /**
   * Вернувшаяся позиция без возврата в окне получает прежнее состояние: заказ
   * обновился позже возврата, и повторный опрос не должен стирать известное.
   */
  private async keepReturnConditions(
    telegramUserId: string,
    lines: IAccountingOrderLineInput[],
  ): Promise<IAccountingOrderLineInput[]> {
    const blank = lines.filter((line) => line.returnedOn && !line.returnCondition);
    if (!blank.length) return lines;
    const stored = await this.lines.currentValues(
      telegramUserId,
      'ym',
      blank.map((line) => line.orderId),
    );
    return lines.map((line) => {
      if (!line.returnedOn || line.returnCondition) return line;
      const previous = stored.get(`${line.orderId}|${line.itemId}`)?.returnCondition ?? null;
      return previous ? { ...line, returnCondition: previous } : line;
    });
  }

  /**
   * Возврат обновился, а его заказ — нет: сохранённые вернувшиеся строки
   * переписываются с новым состоянием (смена отпечатка → новая версия). Строки
   * ещё нет — пропуск: состояние придёт со следующим обновлением возврата.
   */
  private async restampReturns(
    telegramUserId: string,
    orderIds: string[],
    conditions: Map<string, Map<string, TReturnCondition>>,
  ): Promise<IAccountingOrderLineInput[]> {
    if (!orderIds.length) return [];
    const stored = await this.lines.currentValues(telegramUserId, 'ym', orderIds);
    const lines: IAccountingOrderLineInput[] = [];
    for (const [key, value] of stored) {
      const split = key.indexOf('|');
      const orderId = key.slice(0, split);
      const condition = conditions.get(orderId)?.get(value.offerId ?? '');
      if (!value.returnedOn || !condition || condition === value.returnCondition) continue;
      lines.push({
        ...value,
        marketplace: 'ym',
        orderId,
        itemId: key.slice(split + 1),
        returnCondition: condition,
      });
    }
    return lines;
  }

  /** Ozon и WB: сырьё через реестр, разбор — мапперами «Финучёта». */
  private async syncRegistry(
    telegramUserId: string,
    marketplace: Exclude<TFinanceMarketplace, 'ym'>,
    now: Date,
    options: IAccountingOrdersSyncOptions,
  ): Promise<IAccountingOrdersSyncResult> {
    const source = this.registry.capability(marketplace, 'orderLines');
    if (!source) return await this.notConnected(telegramUserId, marketplace, now);

    const window =
      marketplace === 'ozon'
        ? ozonOrderLinesWindow(now)
        : await this.cursorWindow(telegramUserId, marketplace, now, options);
    let records: IMarketplaceRawOrderLine[];
    try {
      records = await source.rawOrderLines({ telegramUserId, marketplace }, window);
    } catch (error) {
      if (error instanceof MarketplaceNotConnectedError) {
        return await this.notConnected(telegramUserId, marketplace, now);
      }
      throw error;
    }

    const totals = { ...EMPTY, orders: records.length };
    const writer = this.writer(telegramUserId, now, totals);
    if (marketplace === 'ozon') {
      for (const record of records) {
        await writer.push(ozonOrderLines(record.raw as IOzonPostingRaw));
      }
    } else {
      await writer.push(await this.wbLines(telegramUserId, records));
    }
    await writer.flush();
    return await this.recordDone(telegramUserId, marketplace, now, window, totals);
  }

  /**
   * Строки WB по `srid`: последняя строка заказа побеждает (стык страниц);
   * возврат окончателен — поздний выкуп его не перекрывает. Продажа без заказа
   * в окне ложится поверх сохранённой строки.
   */
  private async wbLines(
    telegramUserId: string,
    records: readonly IMarketplaceRawOrderLine[],
  ): Promise<IAccountingOrderLineInput[]> {
    const orders = new Map<string, IWbOrderRowRaw>();
    const sales = new Map<string, IWbSaleRowRaw>();
    for (const record of records) {
      const raw = record.raw as IWbSaleRowRaw;
      const srid = typeof raw?.srid === 'string' ? raw.srid.trim() : '';
      if (!srid) continue;
      if (record.kind === 'wb-order') {
        orders.set(srid, raw);
        continue;
      }
      if (record.kind !== 'wb-sale') continue;
      const known = sales.get(srid);
      if (known?.saleID?.toUpperCase().startsWith('R')) continue;
      sales.set(srid, raw);
    }

    const orphans = [...sales.keys()].filter((srid) => !orders.has(srid));
    const stored = await this.lines.currentValues(telegramUserId, 'wb', orphans);
    const previousOf = new Map<string, IAccountingOrderLineValue>();
    for (const [key, value] of stored) previousOf.set(key.slice(0, key.lastIndexOf('|')), value);

    const lines: IAccountingOrderLineInput[] = [];
    for (const srid of new Set([...orders.keys(), ...sales.keys()])) {
      const line = wbOrderLine(
        orders.get(srid) ?? null,
        sales.get(srid) ?? null,
        previousOf.get(srid) ?? null,
      );
      if (line) lines.push(line);
    }
    return lines;
  }

  /** Запись пачками по `FLUSH_LINES`: позиции одного заказа не рвутся. */
  private writer(
    telegramUserId: string,
    now: Date,
    totals: { seen: number; created: number; changed: number },
  ): {
    push: (lines: readonly IAccountingOrderLineInput[]) => Promise<void>;
    flush: () => Promise<void>;
  } {
    let batch: IAccountingOrderLineInput[] = [];
    const flush = async () => {
      if (!batch.length) return;
      const written = await this.lines.upsertLines(telegramUserId, batch, now);
      totals.seen += written.seen;
      totals.created += written.created;
      totals.changed += written.changed;
      batch = [];
    };
    return {
      push: async (lines) => {
        for (const line of lines) batch.push(line);
        if (batch.length >= FLUSH_LINES) await flush();
      },
      flush,
    };
  }

  private async cursorWindow(
    telegramUserId: string,
    marketplace: TFinanceMarketplace,
    now: Date,
    options: IAccountingOrdersSyncOptions,
  ): Promise<IOrderLinesWindow> {
    const state = options.ignoreCursor
      ? null
      : await this.lines.syncState(telegramUserId, marketplace);
    return orderLinesWindow(state?.cursorAt ?? null, now, options.firstDays);
  }

  private async notConnected(
    telegramUserId: string,
    marketplace: TFinanceMarketplace,
    now: Date,
  ): Promise<IAccountingOrdersSyncResult> {
    await this.lines.recordSuccess({
      telegramUserId,
      marketplace,
      outcome: 'not-connected',
      at: now,
      cursorAt: null,
      linesSeen: 0,
      versionsWritten: 0,
    });
    return { outcome: 'not-connected', ...EMPTY };
  }

  private async recordDone(
    telegramUserId: string,
    marketplace: TFinanceMarketplace,
    now: Date,
    window: IOrderLinesWindow,
    totals: typeof EMPTY,
  ): Promise<IAccountingOrdersSyncResult> {
    const versions = totals.created + totals.changed;
    const outcome = versions ? 'imported' : 'unchanged';
    await this.lines.recordSuccess({
      telegramUserId,
      marketplace,
      outcome,
      at: now,
      cursorAt: window.to,
      linesSeen: totals.seen,
      versionsWritten: versions,
    });
    return {
      outcome,
      window: { from: window.from.toISOString(), to: window.to.toISOString() },
      ...totals,
    };
  }

  /**
   * Клиенты всех магазинов кабинета: кэш `stores` по business_id, при промахе —
   * живой `listStores`; активный магазин — всегда (правило `campaignClients` сверки).
   */
  private async campaignClients(store: YandexMarketDocument): Promise<YandexApiClient[]> {
    const businessId = String(store.business_id);
    let campaigns = (store.stores ?? [])
      .filter((entry) => String(entry.businessId) === businessId)
      .map((entry) => String(entry.campaignId));
    if (!campaigns.length) {
      const live = await this.clients.forStore(store).listStores();
      campaigns = live
        .filter((entry) => String(entry.businessId) === businessId)
        .map((entry) => String(entry.campaignId));
    }
    const unique = [...new Set([String(store.campaign_id), ...campaigns])];
    return unique.map((campaignId) =>
      this.clients.forTenant({ token: store.token, campaignId, businessId }),
    );
  }
}
