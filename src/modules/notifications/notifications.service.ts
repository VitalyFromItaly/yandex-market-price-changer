import type {
  IActiveNotification,
  INotificationEvent,
  TNotificationRule,
  TNotificationRuleSettings,
} from './notifications.domain';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { ISellerNotificationRow } from '../../database/services/seller-notification.service';
import type { IFinancePeriod } from '../finance/finance-period';
import type { TFeatureMap } from '../telegram/bots/shared/features.domain';

import { Injectable } from '@nestjs/common';

import { FINANCE_MARKETPLACES } from '../../database/postgres/finance.schema';
import { FinanceAnomalyRepository } from '../../database/postgres/repositories/finance-anomaly.repository';
import { ProductService } from '../../database/services/product.service';
import { SellerNotificationSettingsService } from '../../database/services/seller-notification-settings.service';
import { SellerNotificationService } from '../../database/services/seller-notification.service';
import { YandexMarketService } from '../../database/services/yandex-market.service';
import { ErrorReporter } from '../errors/error-reporter.service';
import {
  YM_NETTING_REPORT_TYPE,
  financePeriodKey,
  financeToday,
  monthPeriod,
  shiftDay,
} from '../finance/finance-period';
import { FinanceTaxYearService } from '../finance/finance-tax-year.service';
import { FinanceService } from '../finance/finance.service';
import { ReturnsAnalyticsService } from '../finance/returns-analytics.service';
import { INVENTORY_BASIS_DAYS } from '../inventory/inventory.domain';
import { InventoryService } from '../inventory/inventory.service';
import { isMarketplaceFeatureOpen } from '../marketplaces/marketplace-connections.domain';

import {
  LONG_WINDOW_DAYS,
  NOTIFICATION_RULE,
  SALES_WINDOW_DAYS,
  STOCK_RULES,
  anomalyEvents,
  diffNotifications,
  productLossEvents,
  returnsEvents,
  salesEvents,
  stockEvents,
  stockLinesOf,
  subjectMarketplace,
  taxEvents,
} from './notifications.domain';

export interface INotificationsCheckResult {
  /** Новые уведомления этого прогона — их и шлёт сводка Telegram. */
  created: ISellerNotificationRow[];
  resolved: number;
  /** Правила, которые не посчитались (сбой или нет данных), — их активные не тронуты. */
  skipped: string[];
}

/** Окно в `days` дней, кончающееся днём `endOffset` дней назад (вчера = 1). */
function window(today: string, days: number, endOffset: number): IFinancePeriod {
  return { from: shiftDay(today, -(endOffset + days - 1)), to: shiftDay(today, -endOffset) };
}

/**
 * Проверка правил уведомлений продавца (TASK-152). Только чтение отчётов —
 * журнал Postgres, аномалии, налоговый год, сборка склада (остатки площадок —
 * живые вызовы, поэтому только из очереди, не из запроса). Каждая группа правил
 * — в своём try/catch: упавшая группа не трогает свои активные уведомления и
 * не мешает остальным.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly settings: SellerNotificationSettingsService,
    private readonly notifications: SellerNotificationService,
    private readonly stores: YandexMarketService,
    private readonly products: ProductService,
    private readonly finance: FinanceService,
    private readonly returns: ReturnsAnalyticsService,
    private readonly taxYear: FinanceTaxYearService,
    private readonly anomalies: FinanceAnomalyRepository,
    private readonly inventory: InventoryService,
    private readonly errors: ErrorReporter,
  ) {}

  async check(
    telegramUserId: string,
    features: TFeatureMap,
    now: Date = new Date(),
  ): Promise<INotificationsCheckResult> {
    const settings = (await this.settings.get(telegramUserId)).rules;
    const today = financeToday(now);
    const events: INotificationEvent[] = [];
    const skippedRules = new Set<TNotificationRule>();
    const skippedMarketplaces = new Set<string>();

    const fail = (error: unknown, action: string) => {
      void this.errors.report({
        error: error as Error,
        source: 'queue',
        context: 'seller-notifications',
        action: `${action} (продавец ${telegramUserId})`,
      });
    };

    for (const marketplace of FINANCE_MARKETPLACES) {
      if (!isMarketplaceFeatureOpen(features, marketplace)) continue;
      try {
        const ready = await this.marketplaceEvents(
          telegramUserId,
          marketplace,
          { today, now, settings },
          events,
        );
        if (!ready) skippedMarketplaces.add(marketplace);
      } catch (error) {
        skippedMarketplaces.add(marketplace);
        fail(error, `правила площадки ${marketplace}`);
      }
    }

    try {
      events.push(
        ...anomalyEvents(await this.unreviewedAnomalies(telegramUserId, today), settings),
      );
    } catch (error) {
      skippedRules.add(NOTIFICATION_RULE.COMMISSION_CHANGE);
      skippedRules.add(NOTIFICATION_RULE.SUSPICIOUS_WITHHOLDINGS);
      fail(error, 'аномалии журнала');
    }

    try {
      const report = await this.taxYear.build(telegramUserId, Number(today.slice(0, 4)), now);
      events.push(...taxEvents(report.taxYear.warnings, settings));
    } catch (error) {
      skippedRules.add(NOTIFICATION_RULE.TAX_LIMIT);
      fail(error, 'налоговый год');
    }

    if (STOCK_RULES.some((rule) => settings[rule].enabled)) {
      try {
        const snapshot = await this.inventory.build({
          telegramUserId,
          store: await this.stores.findByTelegramUser(telegramUserId),
          features,
          now,
          movements: false,
        });
        // Площадка не дала остатки или журнал не загружен — склад неполный:
        // по нему «закончилось» было бы ложью. Правила склада ждут следующего дня.
        if (snapshot.problems.length) STOCK_RULES.forEach((rule) => skippedRules.add(rule));
        else events.push(...stockEvents(stockLinesOf(snapshot), INVENTORY_BASIS_DAYS, settings));
      } catch (error) {
        STOCK_RULES.forEach((rule) => skippedRules.add(rule));
        fail(error, 'остатки');
      }
    }

    const isSkipped = (row: IActiveNotification) => {
      if (skippedRules.has(row.rule)) return true;
      const marketplace = subjectMarketplace(row);
      return marketplace !== null && skippedMarketplaces.has(marketplace);
    };
    const active = await this.notifications.listActive(telegramUserId);
    const diff = diffNotifications(active, events, isSkipped);
    const created = await this.notifications.apply(
      telegramUserId,
      diff.toResolve,
      diff.toCreate,
      now,
    );
    return {
      created,
      resolved: diff.toResolve.length,
      skipped: [...skippedRules, ...[...skippedMarketplaces].map((mp) => `marketplace:${mp}`)],
    };
  }

  /**
   * Продажи, расходы, убыток товаров и возвраты одной площадки. false — журнал
   * окна не загружен целиком: неполная неделя дала бы ложное «продажи упали».
   */
  private async marketplaceEvents(
    telegramUserId: string,
    marketplace: TFinanceMarketplace,
    { today, now, settings }: { today: string; now: Date; settings: TNotificationRuleSettings },
    events: INotificationEvent[],
  ): Promise<boolean> {
    const options = { flat: false, marketplace } as const;
    const [current, previous, long] = await Promise.all([
      this.finance.build(telegramUserId, window(today, SALES_WINDOW_DAYS, 1), now, options),
      this.finance.build(
        telegramUserId,
        window(today, SALES_WINDOW_DAYS, SALES_WINDOW_DAYS + 1),
        now,
        options,
      ),
      this.finance.build(telegramUserId, window(today, LONG_WINDOW_DAYS, 1), now, options),
    ]);
    const loaded = [current, previous, long].every((report) =>
      report.months.every((month) => month.status !== null),
    );
    if (!loaded) return false;

    events.push(
      ...salesEvents([{ marketplace, current: current.pnl, previous: previous.pnl }], settings),
    );

    const lossSkus = long.pnl.skus.skus.filter((row) => row.netKopecks < 0).map((row) => row.sku);
    const names = new Map<string, string>();
    if (lossSkus.length) {
      for (const product of await this.products.findByYmSkus(telegramUserId, lossSkus)) {
        const sku = product.marketplaceSkus?.ym;
        if (sku) names.set(sku, product.name);
      }
    }
    events.push(...productLossEvents(marketplace, long.pnl.skus.skus, names, settings));

    const [returnsNow, returnsBefore] = await Promise.all([
      this.returns.build(telegramUserId, marketplace, window(today, LONG_WINDOW_DAYS, 1)),
      this.returns.build(
        telegramUserId,
        marketplace,
        window(today, LONG_WINDOW_DAYS, LONG_WINDOW_DAYS + 1),
      ),
    ]);
    events.push(...returnsEvents(marketplace, returnsNow.totals, returnsBefore.totals, settings));
    return true;
  }

  /** Непросмотренные аномалии ЯМ за прошлый и текущий месяц. */
  private async unreviewedAnomalies(telegramUserId: string, today: string) {
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    const months = [
      month === 1 ? monthPeriod(year - 1, 12) : monthPeriod(year, month - 1),
      monthPeriod(year, month),
    ];
    const rows = [];
    for (const period of months) {
      const page = await this.anomalies.list({
        telegramUserId,
        periodKey: financePeriodKey(YM_NETTING_REPORT_TYPE, period),
        unreviewedOnly: true,
        limit: 500,
      });
      rows.push(...page.items);
    }
    return rows;
  }
}
