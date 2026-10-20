import type { TMarketplace } from '../../../shared/marketplace';
import type { IStockPushPlan, TStockPushBlock, TStockPushSkip } from '../../finance/stock-push';
import type { IStockPushPlanResult } from '../../stock-push/stock-push.service';

import { MARKETPLACE_LABEL } from '../../../shared/marketplace';
import {
  STOCK_PUSH_BLOCK_TEXT,
  STOCK_PUSH_MAX_ZEROED,
  STOCK_PUSH_ORDERS_WINDOW_DAYS,
  STOCK_PUSH_SKIP_TEXT,
} from '../../finance/stock-push';

/**
 * «Передача остатков» CRM (TASK-143) — доставка. План считает лист
 * `finance/stock-push.ts`, здесь тексты и перечисление полей ответа.
 */

export const STOCK_PUSH_KIND = 'stock-push:plan';
export const STOCK_PUSH_APPLY_KIND = 'stock-push:apply';

export const PUSH_RUNNING = 'PUSH_RUNNING';
export const PUSH_RUNNING_TEXT = 'Запись остатков уже идёт — дождитесь её итога.';
export const WRITE_CLOSED = 'WRITE_CLOSED';
export const WRITE_CLOSED_TEXT =
  'Запись остатков закрыта: её открывает администратор отдельно для каждой площадки.';
export const INVALID_PLAN = 'INVALID_PLAN';
export const INVALID_PLAN_TEXT = 'Нет отпечатка плана — обновите план и подтвердите его ещё раз.';

/** Правило одной строкой — на экране под шапкой, чтобы число «станет» читалось. */
export const STOCK_PUSH_RULE_TEXT =
  'Станет = количество из последнего прайса минус штуки заказов со своего склада ' +
  '(FBS/DBS/Экспресс) всех подключённых площадок, оформленных с дня загрузки прайса. ' +
  'Заказы дня загрузки вычитаются тоже: у заказа есть только день, а занизить остаток ' +
  'безопаснее, чем завысить. Отменённые не вычитаются, возвраты не прибавляются.';

export const STOCK_PUSH_NOTES: readonly string[] = [
  `Прайс старше ${STOCK_PUSH_ORDERS_WINDOW_DAYS} дней не годится: заказы площадок читаются за последние 30 дней.`,
  `Больше ${STOCK_PUSH_MAX_ZEROED} обнулений на площадку — запись на неё останавливается.`,
  'Склады площадок (FBY, FBO, FBW) не пишутся никогда: там остаток ведёт площадка.',
  'Артикулы, которых нет в остатках площадки, не пишутся — запись только меняет существующие.',
];

export interface ICrmStockPushRow {
  internalSku: string;
  name: string | null;
  sku: string;
  from: number;
  to: number;
  priceListStock: number;
  sold: number;
}

export interface ICrmStockPushTarget {
  marketplace: TMarketplace;
  marketplaceLabel: string;
  key: string;
  name: string;
  placement: string | null;
  blockedBy: TStockPushBlock | null;
  blockedText: string | null;
  error: string | null;
  updates: ICrmStockPushRow[];
  zeroed: number;
  unchanged: number;
  notListed: number;
  /** Будет ли эта площадка записана кнопкой: ЯМ без блокировки и с изменениями. */
  willWrite: boolean;
}

export interface ICrmStockPush {
  takenAt: string;
  priceListDay: string | null;
  planHash: string;
  /** Открыта ли продавцу кнопка записи (`stock_push_write_ym`). */
  writeOpen: boolean;
  /** Сколько позиций уйдёт в запись по кнопке. */
  writeCount: number;
  ruleText: string;
  notes: string[];
  orderErrors: { marketplaceLabel: string; source: string; error: string }[];
  notConsidered: { marketplaceLabel: string; reason: string }[];
  targets: ICrmStockPushTarget[];
  skipped: {
    internalSku: string;
    name: string | null;
    reason: TStockPushSkip;
    reasonText: string;
  }[];
}

export function toCrmStockPush(
  result: IStockPushPlanResult,
  context: {
    now: Date;
    /** Открыта ли фича записи площадки (`STOCK_PUSH_WRITE_FEATURE`, TASK-175). */
    writeOpen: Readonly<Record<TMarketplace, boolean>>;
  },
): ICrmStockPush {
  const plan: IStockPushPlan = result.plan;
  const targets = plan.targets.map((target): ICrmStockPushTarget => {
    const willWrite =
      context.writeOpen[target.marketplace] &&
      target.blockedBy === null &&
      target.updates.length > 0;
    return {
      marketplace: target.marketplace,
      marketplaceLabel: MARKETPLACE_LABEL[target.marketplace],
      key: target.key,
      name: target.name,
      placement: target.placement,
      blockedBy: target.blockedBy,
      blockedText: target.blockedBy ? STOCK_PUSH_BLOCK_TEXT[target.blockedBy] : null,
      error: target.error ?? null,
      updates: target.updates.map((row) => ({
        internalSku: row.internalSku,
        name: row.name,
        sku: row.sku,
        from: row.from,
        to: row.to,
        priceListStock: row.priceListStock,
        sold: row.sold,
      })),
      zeroed: target.zeroed,
      unchanged: target.unchanged,
      notListed: target.notListed,
      willWrite,
    };
  });
  return {
    takenAt: context.now.toISOString(),
    priceListDay: plan.priceListDay,
    planHash: plan.planHash,
    writeOpen: Object.values(context.writeOpen).some(Boolean),
    writeCount: targets
      .filter((target) => target.willWrite)
      .reduce((sum, target) => sum + target.updates.length, 0),
    ruleText: STOCK_PUSH_RULE_TEXT,
    notes: [...STOCK_PUSH_NOTES],
    orderErrors: plan.orderErrors.map((item) => ({
      marketplaceLabel: MARKETPLACE_LABEL[item.marketplace],
      source: item.source,
      error: item.error,
    })),
    notConsidered: result.notConsidered.map((item) => ({
      marketplaceLabel: MARKETPLACE_LABEL[item.marketplace],
      reason: item.reason,
    })),
    targets,
    skipped: plan.skipped.map((item) => ({
      internalSku: item.internalSku,
      name: item.name,
      reason: item.reason,
      reasonText: STOCK_PUSH_SKIP_TEXT[item.reason],
    })),
  };
}

/** Отпечаток плана — sha256 hex: остальное до процессора не доходит. */
export function parsePlanHash(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : null;
}
