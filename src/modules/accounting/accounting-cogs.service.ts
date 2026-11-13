import type {
  IAccountingOrderLineInput,
  IAccountingOrderLineValue,
} from './accounting-order-lines.domain';
import type { ITaxCogs, ITaxCogsLine } from './accounting-tax';
import type { TOrderLotCostOf, TOrderUnitCost } from './order-result';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { IFinancePeriod } from '../finance/finance-period';
import type { IPnlOperation } from '../finance/pnl';

import { Injectable } from '@nestjs/common';

import { AccountingOrderLineRepository } from '../../database/postgres/repositories/accounting-order-line.repository';
import { ProductService } from '../../database/services/product.service';
import { YandexMarketService } from '../../database/services/yandex-market.service';
import { pnlLineOf } from '../finance/pnl';
import { discountsOf, ratesOf } from '../yandex/reports/profit';

import { accountingUnitCost } from './accounting-cost-history.domain';
import { AccountingCostHistoryService } from './accounting-cost-history.service';
import { AccountingCostSettingsService } from './accounting-cost-settings.service';
import { AccountingLotCostService } from './accounting-lot-cost.service';
import { taxCogsOf } from './accounting-tax';
import { isCancelledOrderLine, saleMomentOf } from './order-result';

const idOf = (product: object): string => String((product as { _id?: unknown })._id);

/**
 * Режим Б для налога: себестоимость строки журнала (заказ + артикул) — сумма
 * партий FIFO позиций этого заказа с тем же артикулом. Штук в журнале меньше,
 * чем в позициях, — доля одним округлением. Возврат товара уменьшает расход,
 * только если штуки вернулись в партию; повреждённый/утраченный остаётся
 * расходом (списание). Неизвестно что-то — null (строка в `unknown`).
 */
function lotTotalResolver(
  marketplace: TFinanceMarketplace,
  values: ReadonlyMap<string, IAccountingOrderLineValue>,
  lotCostOf: TOrderLotCostOf,
): (orderId: string, sku: string, count: number, goods: ITaxCogsLine['goods']) => number | null {
  const byOrder = new Map<string, IAccountingOrderLineInput[]>();
  for (const [key, value] of values) {
    const cut = key.lastIndexOf('|');
    const line = { ...value, marketplace, orderId: key.slice(0, cut), itemId: key.slice(cut + 1) };
    if (isCancelledOrderLine(line)) continue;
    const list = byOrder.get(line.orderId) ?? [];
    list.push(line);
    byOrder.set(line.orderId, list);
  }
  return (orderId, sku, count, goods) => {
    const lines = (byOrder.get(orderId) ?? []).filter((line) => line.offerId === sku);
    if (!lines.length) return null;
    let total = 0;
    let units = 0;
    for (const line of lines) {
      const cost = lotCostOf(line);
      if (cost.status === 'unknown') return null;
      const restored = cost.returned ? cost.returned.restored : true;
      total += goods === 'returned' && !restored ? 0 : cost.kopecks;
      units += line.count;
    }
    return count === units ? total : Math.round((total * count) / units);
  };
}

/**
 * Себестоимость v2 строк журнала, двигающих товар (TASK-221): вычет налога
 * «Доходы минус расходы» нового учёта. Одна дверь «строка журнала → закуп на
 * момент продажи», чтобы сервис карточки (TASK-222) не завёл вторую.
 *
 * Момент продажи — `saleMomentOf` строк заказа (`accounting_order_lines`, день
 * оформления); товар — `ProductService.findByJournalSkus` (ключ закупа журнала
 * площадки, как у P&L); закуп — `accountingUnitCost` по записям v2. Не нашлось
 * что-то из трёх — закуп неизвестен, строка не вычитается.
 */
@Injectable()
export class AccountingCogsService {
  constructor(
    private readonly orderLines: AccountingOrderLineRepository,
    private readonly products: ProductService,
    private readonly costHistory: AccountingCostHistoryService,
    private readonly stores: YandexMarketService,
    private readonly costSettings: AccountingCostSettingsService,
    private readonly lotCost: AccountingLotCostService,
  ) {}

  /**
   * Режим себестоимости продавца (TASK-215): Б — резолвер партий FIFO (одно
   * списание на все площадки), А — `undefined` (закуп из прайса, `unitCostResolver`).
   */
  async lotCostOf(
    telegramUserId: string,
    features: Readonly<Record<string, boolean>>,
  ): Promise<TOrderLotCostOf | undefined> {
    const method = await this.costSettings.methodOf(telegramUserId, features);
    return method === 'lot_fifo' ? this.lotCost.lotCostResolver(telegramUserId) : undefined;
  }

  async cogsOf(
    telegramUserId: string,
    marketplace: TFinanceMarketplace,
    ops: readonly IPnlOperation[],
    period: IFinancePeriod,
    /** Режим Б — себестоимость по партиям FIFO (`AccountingLotCostService`); нет — А. */
    lotCostOf?: TOrderLotCostOf,
  ): Promise<ITaxCogs> {
    const moving = ops
      .map((op) => ({ op, line: pnlLineOf({ ...op, marketplace }) }))
      .filter(
        ({ line }) => line.goods && line.accruedDay >= period.from && line.accruedDay <= period.to,
      );
    if (!moving.length) return { kopecks: 0, unknown: { count: 0, operationIds: [] } };

    const orderIds = [...new Set(moving.map(({ op }) => op.orderId).filter(Boolean))];
    const skus = [...new Set(moving.map(({ line }) => line.sku).filter(Boolean))];
    const [values, unitCostOf] = await Promise.all([
      this.orderLines.currentValues(telegramUserId, marketplace, orderIds),
      this.unitCostResolver(telegramUserId, marketplace, lotCostOf ? [] : skus),
    ]);

    // Момент продажи заказа — самый ранний день оформления его позиций.
    const momentOf = new Map<string, Date>();
    for (const [key, value] of values) {
      const moment = saleMomentOf(value);
      if (!moment) continue;
      const orderId = key.slice(0, key.lastIndexOf('|'));
      const known = momentOf.get(orderId);
      if (!known || moment < known) momentOf.set(orderId, moment);
    }

    const lineOps = new Map<ITaxCogsLine, IPnlOperation>();
    const lines: ITaxCogsLine[] = moving.map(({ op, line }) => {
      const cogsLine: ITaxCogsLine = {
        id: line.id,
        goods: line.goods,
        count: line.count,
        accruedDay: line.accruedDay,
      };
      lineOps.set(cogsLine, op);
      return cogsLine;
    });

    if (lotCostOf) {
      const lotTotalOf = lotTotalResolver(marketplace, values, lotCostOf);
      return taxCogsOf(lines, period, (line) => {
        const op = lineOps.get(line);
        return op?.orderId && op.sku
          ? lotTotalOf(op.orderId, op.sku, line.count, line.goods)
          : null;
      });
    }

    return taxCogsOf(lines, period, (line) => {
      const op = lineOps.get(line);
      const moment = op?.orderId ? momentOf.get(op.orderId) : undefined;
      if (!op?.sku || !moment) return null;
      const unit = unitCostOf(op.sku, moment);
      // Закуп единицы — целые копейки, штуки — целые: округлять нечего.
      return unit.status === 'known' ? unit.kopecks * line.count : null;
    });
  }

  /**
   * Закуп единицы v2 по ключу товара площадки на момент — одна дверь и для
   * налога, и для карточки заказа (TASK-222): товар — `findByJournalSkus`,
   * записи — `recordsOf`, формула — `accountingUnitCost`. Нет товара —
   * `no-product`, нет записи на момент — `no-record`.
   */
  async unitCostResolver(
    telegramUserId: string,
    marketplace: TFinanceMarketplace,
    skus: readonly string[],
  ): Promise<(sku: string, moment: Date) => TOrderUnitCost> {
    const unique = [...new Set(skus.filter(Boolean))];
    if (!unique.length) return () => ({ status: 'unknown', reason: 'no-product' });
    const [bySku, store] = await Promise.all([
      this.products.findByJournalSkus(telegramUserId, marketplace, unique),
      this.stores.findByTelegramUser(telegramUserId),
    ]);
    const records = await this.costHistory.recordsOf(telegramUserId, [...bySku.values()].map(idOf));
    const config = discountsOf(ratesOf(store ?? {}));
    return (sku, moment) => {
      const product = bySku.get(sku);
      if (!product) return { status: 'unknown', reason: 'no-product' };
      return accountingUnitCost(product, records.get(idOf(product)), config, moment);
    };
  }
}
