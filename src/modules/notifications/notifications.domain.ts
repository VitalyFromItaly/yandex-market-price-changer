import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { IFinanceAnomalyRow } from '../../database/postgres/repositories/finance-anomaly.repository';
import type { TAnomalyKind } from '../finance/finance-anomalies';
import type { IPnl } from '../finance/pnl';
import type { IReturnFigures } from '../finance/returns-analytics';
import type { ITaxYearWarning } from '../finance/tax-year';
import type { IInventorySnapshot } from '../inventory/inventory.domain';

import { DEFAULT_COVER_DAYS, purchaseNeedsOf } from '../finance/forecast-purchases';
import { INVENTORY_LOW_DAYS, daysLeftOf } from '../finance/inventory';

import { NOTIFICATION_TEXT } from './notifications.text';

/**
 * Правила уведомлений продавцу (TASK-152). Чистые функции: детекторы получают
 * готовые отчёты (P&L, возвраты, аномалии, склад, налоговый год) и настройки,
 * отдают события; `diffNotifications` решает, какие из них — новые уведомления.
 * Почему так и откуда пороги — `README.md` рядом.
 */

export const NOTIFICATION_RULE = {
  SALES_DROP: 'sales_drop',
  EXPENSES_GROWTH: 'expenses_growth',
  COMMISSION_CHANGE: 'commission_change',
  SUSPICIOUS_WITHHOLDINGS: 'suspicious_withholdings',
  PRODUCT_LOSS: 'product_loss',
  OUT_OF_STOCK: 'out_of_stock',
  LOW_STOCK: 'low_stock',
  STOCK_RUNNING_OUT: 'stock_running_out',
  PURCHASE_NEEDED: 'purchase_needed',
  STALE_STOCK: 'stale_stock',
  STOCK_VALUE_HIGH: 'stock_value_high',
  RETURNS_GROWTH: 'returns_growth',
  TAX_LIMIT: 'tax_limit',
} as const;

export type TNotificationRule = (typeof NOTIFICATION_RULE)[keyof typeof NOTIFICATION_RULE];

/** Единица порога — для подписи поля в настройках. null — порога у правила нет. */
export type TThresholdUnit = 'percent' | 'points' | 'units' | 'days' | 'rub';

export interface INotificationRuleMeta {
  label: string;
  description: string;
  unit: TThresholdUnit | null;
  defaultThreshold: number | null;
  /** Допустимый диапазон порога (включительно). */
  min: number | null;
  max: number | null;
}

/** Окна сравнения: неделя к неделе для продаж и расходов, 28 дней к 28 для возвратов и убытка. */
export const SALES_WINDOW_DAYS = 7;
export const LONG_WINDOW_DAYS = 28;
/** Ниже этой выручки базовой недели падение продаж не считается: на копейках любые проценты шумят. */
export const SALES_DROP_MIN_BASE_KOPECKS = 1_000_000;
/** Возвраты: база прошлого окна — хотя бы столько проданных штук, иначе доля случайна. */
export const RETURNS_MIN_SOLD_UNITS = 10;

export const NOTIFICATION_RULES: Record<TNotificationRule, INotificationRuleMeta> = {
  sales_drop: {
    label: 'Продажи резко снизились',
    description:
      'Выручка последних 7 дней ниже предыдущих 7 на порог и больше (по каждой площадке).',
    unit: 'percent',
    defaultThreshold: 30,
    min: 5,
    max: 95,
  },
  expenses_growth: {
    label: 'Расходы площадки выросли',
    description:
      'Доля услуг и удержаний площадки в выручке за 7 дней выросла на порог к прошлой неделе.',
    unit: 'points',
    defaultThreshold: 5,
    min: 1,
    max: 50,
  },
  commission_change: {
    label: 'Комиссия изменилась',
    description:
      'Найден скачок доли комиссии Маркета против медианы прошлых месяцев (аномалии журнала).',
    unit: null,
    defaultThreshold: null,
    min: null,
    max: null,
  },
  suspicious_withholdings: {
    label: 'Подозрительные удержания',
    description:
      'Штраф, возможное двойное начисление или удержание неизвестной статьи (непросмотренные аномалии).',
    unit: null,
    defaultThreshold: null,
    min: null,
    max: null,
  },
  product_loss: {
    label: 'Товар в убытке',
    description:
      'Чистая прибыль товара за 28 дней меньше нуля (только товары с известной себестоимостью).',
    unit: null,
    defaultThreshold: null,
    min: null,
    max: null,
  },
  out_of_stock: {
    label: 'Товар закончился',
    description: 'Товар продавался за 28 дней, а доступного остатка нет.',
    unit: null,
    defaultThreshold: null,
    min: null,
    max: null,
  },
  low_stock: {
    label: 'Мало остатка',
    description: 'Доступно меньше порога штук у товара, который продавался за 28 дней.',
    unit: 'units',
    defaultThreshold: 5,
    min: 1,
    max: 1000,
  },
  stock_running_out: {
    label: 'Остаток заканчивается',
    description: 'При нынешней скорости продаж остатка хватит на порог дней или меньше.',
    unit: 'days',
    defaultThreshold: INVENTORY_LOW_DAYS,
    min: 1,
    max: 120,
  },
  purchase_needed: {
    label: 'Нужна закупка',
    description: 'Чтобы хватило на порог дней продаж, нужно докупить товары.',
    unit: 'days',
    defaultThreshold: DEFAULT_COVER_DAYS,
    min: 7,
    max: 120,
  },
  stale_stock: {
    label: 'Товар долго не продаётся',
    description: 'Остаток есть, а продаж за 28 дней не было.',
    unit: null,
    defaultThreshold: null,
    min: null,
    max: null,
  },
  stock_value_high: {
    label: 'Много денег в остатках',
    description: 'Остатки по себестоимости (свой склад и склады площадок) стоят порог и больше.',
    unit: 'rub',
    defaultThreshold: 500_000,
    min: 1_000,
    max: 1_000_000_000,
  },
  returns_growth: {
    label: 'Возвраты выросли',
    description:
      'Доля возвратов за 28 дней выросла на порог к прошлым 28 дням, и потери выросли (по каждой площадке).',
    unit: 'points',
    defaultThreshold: 5,
    min: 1,
    max: 100,
  },
  tax_limit: {
    label: 'Приближение налогового лимита',
    description:
      'Доход года подошёл к лимиту УСН или порогу НДС (80 %), прогноз его превышает или он превышен.',
    unit: null,
    defaultThreshold: null,
    min: null,
    max: null,
  },
};

export const NOTIFICATION_RULE_KEYS = Object.keys(NOTIFICATION_RULES) as TNotificationRule[];

export interface INotificationRuleSetting {
  enabled: boolean;
  /** null — у правила нет порога. */
  threshold: number | null;
}

export type TNotificationRuleSettings = Record<TNotificationRule, INotificationRuleSetting>;

/** Все правила включены с порогами по умолчанию: фичу продавцу открывает админ — это и есть согласие. */
export function defaultRuleSettings(): TNotificationRuleSettings {
  const result = {} as TNotificationRuleSettings;
  for (const rule of NOTIFICATION_RULE_KEYS) {
    result[rule] = { enabled: true, threshold: NOTIFICATION_RULES[rule].defaultThreshold };
  }
  return result;
}

/** Сохранённое поверх умолчаний: новое правило без строки в базе — включено с умолчанием. */
export function mergeRuleSettings(
  stored: Partial<Record<string, Partial<INotificationRuleSetting>>> | null | undefined,
): TNotificationRuleSettings {
  const result = defaultRuleSettings();
  for (const rule of NOTIFICATION_RULE_KEYS) {
    const row = stored?.[rule];
    if (!row) continue;
    if (typeof row.enabled === 'boolean') result[rule].enabled = row.enabled;
    if (NOTIFICATION_RULES[rule].unit !== null && typeof row.threshold === 'number') {
      result[rule].threshold = row.threshold;
    }
  }
  return result;
}

/** Порог правила: ошибка — текст для 400, иначе null. */
export function thresholdError(rule: TNotificationRule, value: unknown): string | null {
  const meta = NOTIFICATION_RULES[rule];
  if (meta.unit === null)
    return value === null || value === undefined ? null : 'У правила нет порога';
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Порог должен быть числом';
  if (value < meta.min || value > meta.max) return `Порог — от ${meta.min} до ${meta.max}`;
  return null;
}

/** Событие правила — одно на (правило, предмет). Текст строит `notifications.text.ts`. */
export interface INotificationEvent {
  rule: TNotificationRule;
  /** Предмет: площадка, товар, ключ аномалии, ключ предупреждения налога или `all`. */
  subjectKey: string;
  /**
   * Грубое состояние без чисел. Сменилось — новое уведомление; цифры внутри
   * состояния (остаток 4 → 3) повтора не дают.
   */
  fingerprint: string;
  marketplace: TFinanceMarketplace | null;
  title: string;
  body: string;
}

/** Что уже показано продавцу и ещё не снято. */
export interface IActiveNotification {
  rule: TNotificationRule;
  subjectKey: string;
  fingerprint: string;
}

export interface INotificationsDiff {
  toCreate: INotificationEvent[];
  /** Активные, чьё условие пропало или сменило состояние, — снимаются. */
  toResolve: IActiveNotification[];
}

const stateKey = (rule: string, subjectKey: string) => `${rule}\u0000${subjectKey}`;

/**
 * Дедуп «до смены состояния» — довод `shouldNotify` монитора, но состояние
 * хранится, а не в памяти. Новое событие или сменённый отпечаток → уведомление;
 * пропало → снять (появится снова — снова уведомит). Активное, чьё правило не
 * посчиталось (детектор упал, журнал площадки не загружен, правило выключено —
 * `isSkipped`), не трогается: иначе сбой Postgres снял бы всё, а следующий
 * прогон прислал бы всё заново.
 */
export function diffNotifications(
  active: readonly IActiveNotification[],
  current: readonly INotificationEvent[],
  isSkipped: (row: IActiveNotification) => boolean,
): INotificationsDiff {
  const activeByKey = new Map(active.map((row) => [stateKey(row.rule, row.subjectKey), row]));
  const seen = new Set<string>();
  const toCreate: INotificationEvent[] = [];
  const toResolve: IActiveNotification[] = [];

  for (const event of current) {
    const key = stateKey(event.rule, event.subjectKey);
    if (seen.has(key)) continue;
    seen.add(key);
    const prev = activeByKey.get(key);
    if (prev && prev.fingerprint === event.fingerprint) continue;
    if (prev) toResolve.push(prev);
    toCreate.push(event);
  }
  for (const row of active) {
    if (seen.has(stateKey(row.rule, row.subjectKey)) || isSkipped(row)) continue;
    toResolve.push(row);
  }
  return { toCreate, toResolve };
}

/** Площадка предмета у правил «на площадку» (`ym`, `ozon:SKU`); у остальных — null. */
export function subjectMarketplace(row: IActiveNotification): string | null {
  return MARKETPLACE_RULES.has(row.rule) ? row.subjectKey.split(':')[0] : null;
}

/** Правила, у которых предмет начинается с площадки. */
export const MARKETPLACE_RULES: ReadonlySet<TNotificationRule> = new Set<TNotificationRule>([
  NOTIFICATION_RULE.SALES_DROP,
  NOTIFICATION_RULE.EXPENSES_GROWTH,
  NOTIFICATION_RULE.PRODUCT_LOSS,
  NOTIFICATION_RULE.RETURNS_GROWTH,
]);

// ─── Детекторы ────────────────────────────────────────────────────────────────

const enabled = (settings: TNotificationRuleSettings, rule: TNotificationRule) =>
  settings[rule].enabled;
const threshold = (settings: TNotificationRuleSettings, rule: TNotificationRule) =>
  settings[rule].threshold ?? NOTIFICATION_RULES[rule].defaultThreshold;

/**
 * «Не меньше порога» с допуском: разность долей в плавающей точке (0,25 − 0,2 =
 * 0,0499…) не должна проваливать ровно пороговое значение.
 */
const atLeast = (value: number, limit: number) => value >= limit - 1e-9;

/** P&L площадки за текущее и прошлое окно — то, из чего считаются продажи и расходы. */
export interface IPnlWindowPair {
  marketplace: TFinanceMarketplace;
  current: Pick<IPnl, 'revenueKopecks' | 'marketplaceKopecks'>;
  previous: Pick<IPnl, 'revenueKopecks' | 'marketplaceKopecks'>;
}

/** Продажи и доля расходов площадки: неделя к неделе, по каждой площадке отдельно. */
export function salesEvents(
  pairs: readonly IPnlWindowPair[],
  settings: TNotificationRuleSettings,
): INotificationEvent[] {
  const events: INotificationEvent[] = [];
  for (const { marketplace, current, previous } of pairs) {
    if (
      enabled(settings, NOTIFICATION_RULE.SALES_DROP) &&
      previous.revenueKopecks >= SALES_DROP_MIN_BASE_KOPECKS
    ) {
      const drop = 1 - current.revenueKopecks / previous.revenueKopecks;
      if (atLeast(drop * 100, threshold(settings, NOTIFICATION_RULE.SALES_DROP))) {
        events.push({
          rule: NOTIFICATION_RULE.SALES_DROP,
          subjectKey: marketplace,
          fingerprint: 'drop',
          marketplace,
          ...NOTIFICATION_TEXT.salesDrop({
            marketplace,
            currentKopecks: current.revenueKopecks,
            previousKopecks: previous.revenueKopecks,
            drop,
          }),
        });
      }
    }
    if (
      enabled(settings, NOTIFICATION_RULE.EXPENSES_GROWTH) &&
      current.revenueKopecks > 0 &&
      previous.revenueKopecks > 0
    ) {
      const currentShare = -current.marketplaceKopecks / current.revenueKopecks;
      const previousShare = -previous.marketplaceKopecks / previous.revenueKopecks;
      const growth = (currentShare - previousShare) * 100;
      if (atLeast(growth, threshold(settings, NOTIFICATION_RULE.EXPENSES_GROWTH))) {
        events.push({
          rule: NOTIFICATION_RULE.EXPENSES_GROWTH,
          subjectKey: marketplace,
          fingerprint: 'growth',
          marketplace,
          ...NOTIFICATION_TEXT.expensesGrowth({ marketplace, currentShare, previousShare }),
        });
      }
    }
  }
  return events;
}

/** Товары площадки в убытке за 28 дней. Себестоимость неизвестна — молчим: убыток выдуман. */
export function productLossEvents(
  marketplace: TFinanceMarketplace,
  skus: readonly { sku: string; units: number; netKopecks: number; costKnown: boolean }[],
  names: ReadonlyMap<string, string>,
  settings: TNotificationRuleSettings,
): INotificationEvent[] {
  if (!enabled(settings, NOTIFICATION_RULE.PRODUCT_LOSS)) return [];
  return skus
    .filter((row) => row.costKnown && row.units > 0 && row.netKopecks < 0)
    .map((row) => ({
      rule: NOTIFICATION_RULE.PRODUCT_LOSS,
      subjectKey: `${marketplace}:${row.sku}`,
      fingerprint: 'loss',
      marketplace,
      ...NOTIFICATION_TEXT.productLoss({
        marketplace,
        sku: row.sku,
        name: names.get(row.sku) ?? null,
        netKopecks: row.netKopecks,
        units: row.units,
      }),
    }));
}

const COMMISSION_KINDS: ReadonlySet<TAnomalyKind> = new Set<TAnomalyKind>(['commission_spike']);
const WITHHOLDING_KINDS: ReadonlySet<TAnomalyKind> = new Set<TAnomalyKind>([
  'penalty',
  'duplicate_accrual',
  'unknown_article',
]);

function anomalyRule(kind: TAnomalyKind): TNotificationRule | null {
  if (COMMISSION_KINDS.has(kind)) return NOTIFICATION_RULE.COMMISSION_CHANGE;
  if (WITHHOLDING_KINDS.has(kind)) return NOTIFICATION_RULE.SUSPICIOUS_WITHHOLDINGS;
  return null;
}

/** Непросмотренные аномалии журнала ЯМ: просмотрел в «Финансах» — уведомление снимается. */
export function anomalyEvents(
  rows: readonly Pick<
    IFinanceAnomalyRow,
    'key' | 'kind' | 'detail' | 'amountKopecks' | 'reviewed'
  >[],
  settings: TNotificationRuleSettings,
): INotificationEvent[] {
  const events: INotificationEvent[] = [];
  for (const row of rows) {
    if (row.reviewed) continue;
    const rule = anomalyRule(row.kind);
    if (!rule || !enabled(settings, rule)) continue;
    events.push({
      rule,
      subjectKey: row.key,
      fingerprint: 'unreviewed',
      marketplace: 'ym',
      ...NOTIFICATION_TEXT.anomaly({
        kind: row.kind,
        detail: row.detail,
        amountKopecks: row.amountKopecks,
      }),
    });
  }
  return events;
}

/** Возвраты площадки: 28 дней к прошлым 28; доля и потери должны вырасти обе. */
export function returnsEvents(
  marketplace: TFinanceMarketplace,
  current: Pick<IReturnFigures, 'returnRate' | 'lossesKopecks'>,
  previous: Pick<IReturnFigures, 'returnRate' | 'lossesKopecks' | 'soldUnits'>,
  settings: TNotificationRuleSettings,
): INotificationEvent[] {
  if (!enabled(settings, NOTIFICATION_RULE.RETURNS_GROWTH)) return [];
  if (current.returnRate === null || previous.returnRate === null) return [];
  if (previous.soldUnits < RETURNS_MIN_SOLD_UNITS) return [];
  const growth = (current.returnRate - previous.returnRate) * 100;
  if (!atLeast(growth, threshold(settings, NOTIFICATION_RULE.RETURNS_GROWTH))) return [];
  if (current.lossesKopecks <= previous.lossesKopecks) return [];
  return [
    {
      rule: NOTIFICATION_RULE.RETURNS_GROWTH,
      subjectKey: marketplace,
      fingerprint: 'growth',
      marketplace,
      ...NOTIFICATION_TEXT.returnsGrowth({
        marketplace,
        currentRate: current.returnRate,
        previousRate: previous.returnRate,
        currentLossesKopecks: current.lossesKopecks,
      }),
    },
  ];
}

const TAX_LEVELS: ReadonlySet<string> = new Set(['approaching', 'forecast_exceeds', 'exceeded']);

/** Предупреждения налогового года: состояние — уровень (подошёл → прогноз → превышен). */
export function taxEvents(
  warnings: readonly ITaxYearWarning[],
  settings: TNotificationRuleSettings,
): INotificationEvent[] {
  if (!enabled(settings, NOTIFICATION_RULE.TAX_LIMIT)) return [];
  return warnings
    .filter((warning) => TAX_LEVELS.has(warning.level))
    .map((warning) => ({
      rule: NOTIFICATION_RULE.TAX_LIMIT,
      // usn_approaching / usn_exceeded — один предмет «лимит УСН», уровень — в отпечатке.
      subjectKey: warning.key.split('_')[0],
      fingerprint: warning.level,
      marketplace: null,
      ...NOTIFICATION_TEXT.tax({ text: warning.text }),
    }));
}

/** Строка склада, приведённая к тому, что нужно правилам. */
export interface IStockLine {
  productId: string;
  label: string;
  /** Доступно продать: свой склад (без прайса — FBS площадки) + склады площадок. */
  available: number;
  unitsPerDay: number | null;
  costKopecks: number | null;
  valueKopecks: number | null;
}

/**
 * «Доступно» — свой склад из прайса; прайса нет — наибольший FBS площадок
 * (FBS у площадок — одни и те же штуки, не сумма); плюс склады площадок.
 */
export function stockLinesOf(snapshot: Pick<IInventorySnapshot, 'inventory'>): IStockLine[] {
  return snapshot.inventory.rows.map((row) => {
    let fbs: number | null = null;
    for (const cell of Object.values(row.byMarketplace)) {
      const seller = cell?.seller?.available;
      if (typeof seller === 'number') fbs = Math.max(fbs ?? 0, seller);
    }
    const own = row.ownStock ?? fbs ?? 0;
    const available = Math.max(0, own) + row.atMarketplaces;
    return {
      productId: row.productId,
      label: row.name ? `${row.name} (${row.internalSku})` : row.internalSku,
      available,
      unitsPerDay: row.unitsPerDay,
      costKopecks: row.costKopecks,
      valueKopecks: row.costKopecks === null ? null : row.costKopecks * available,
    };
  });
}

/**
 * Правила остатков. Уровень товара — одно из трёх по строгости: закончился →
 * мало → заканчивается; переход между ними — смена состояния и новое
 * уведомление. Кандидаты — только товары с продажами за окно: нули мёртвых
 * позиций каталога ничего не значат (довод `crm_low_stock_threshold`).
 */
export function stockEvents(
  lines: readonly IStockLine[],
  basisDays: number,
  settings: TNotificationRuleSettings,
): INotificationEvent[] {
  const events: INotificationEvent[] = [];
  const lowUnits = threshold(settings, NOTIFICATION_RULE.LOW_STOCK);
  const lowDays = threshold(settings, NOTIFICATION_RULE.STOCK_RUNNING_OUT);

  for (const line of lines) {
    const selling = line.unitsPerDay !== null && line.unitsPerDay > 0;
    if (!selling) continue;
    const daysLeft = daysLeftOf(line.available, line.unitsPerDay);
    if (line.available === 0) {
      if (enabled(settings, NOTIFICATION_RULE.OUT_OF_STOCK)) {
        events.push(stockEvent(NOTIFICATION_RULE.OUT_OF_STOCK, line, daysLeft));
      }
    } else if (enabled(settings, NOTIFICATION_RULE.LOW_STOCK) && line.available < lowUnits) {
      events.push(stockEvent(NOTIFICATION_RULE.LOW_STOCK, line, daysLeft));
    } else if (
      enabled(settings, NOTIFICATION_RULE.STOCK_RUNNING_OUT) &&
      daysLeft !== null &&
      daysLeft <= lowDays
    ) {
      events.push(stockEvent(NOTIFICATION_RULE.STOCK_RUNNING_OUT, line, daysLeft));
    }
  }

  if (enabled(settings, NOTIFICATION_RULE.PURCHASE_NEEDED)) {
    const coverDays = threshold(settings, NOTIFICATION_RULE.PURCHASE_NEEDED);
    const sold = new Map<string, number>();
    const stocks = new Map<string, number>();
    const costs = new Map<string, number>();
    const labels = new Map<string, string>();
    for (const line of lines) {
      if (!(line.unitsPerDay > 0)) continue;
      sold.set(line.productId, line.unitsPerDay * basisDays);
      stocks.set(line.productId, line.available);
      if (line.costKopecks !== null) costs.set(line.productId, line.costKopecks / 100);
      labels.set(line.productId, line.label);
    }
    const needs = purchaseNeedsOf(sold, stocks, costs, basisDays, coverDays);
    if (needs.rows.length) {
      events.push({
        rule: NOTIFICATION_RULE.PURCHASE_NEEDED,
        subjectKey: 'all',
        fingerprint: 'need',
        marketplace: null,
        ...NOTIFICATION_TEXT.purchaseNeeded({
          coverDays,
          totalUnits: needs.totalUnits,
          totalKopecks: needs.totalKopecks,
          withoutCostSkus: needs.withoutCost.skus,
          rows: needs.rows.map((row) => ({
            label: labels.get(row.sku) ?? row.sku,
            needUnits: row.needUnits,
          })),
        }),
      });
    }
  }

  if (enabled(settings, NOTIFICATION_RULE.STALE_STOCK)) {
    const stale = lines.filter((line) => line.unitsPerDay === 0 && line.available > 0);
    if (stale.length) {
      const withValue = stale.filter((line) => line.valueKopecks !== null);
      events.push({
        rule: NOTIFICATION_RULE.STALE_STOCK,
        subjectKey: 'all',
        fingerprint: 'stale',
        marketplace: null,
        ...NOTIFICATION_TEXT.staleStock({
          basisDays,
          count: stale.length,
          units: stale.reduce((sum, line) => sum + line.available, 0),
          valueKopecks: withValue.length
            ? withValue.reduce((sum, line) => sum + line.valueKopecks, 0)
            : null,
          labels: [...stale]
            .sort((a, b) => (b.valueKopecks ?? 0) - (a.valueKopecks ?? 0))
            .map((line) => line.label),
        }),
      });
    }
  }

  if (enabled(settings, NOTIFICATION_RULE.STOCK_VALUE_HIGH)) {
    const known = lines.filter((line) => line.valueKopecks !== null);
    const total = known.reduce((sum, line) => sum + line.valueKopecks, 0);
    const limitKopecks = threshold(settings, NOTIFICATION_RULE.STOCK_VALUE_HIGH) * 100;
    if (known.length && total >= limitKopecks) {
      events.push({
        rule: NOTIFICATION_RULE.STOCK_VALUE_HIGH,
        subjectKey: 'all',
        fingerprint: 'high',
        marketplace: null,
        ...NOTIFICATION_TEXT.stockValueHigh({
          totalKopecks: total,
          limitKopecks,
          withoutCost: lines.length - known.length,
        }),
      });
    }
  }

  return events;
}

function stockEvent(
  rule:
    | typeof NOTIFICATION_RULE.OUT_OF_STOCK
    | typeof NOTIFICATION_RULE.LOW_STOCK
    | typeof NOTIFICATION_RULE.STOCK_RUNNING_OUT,
  line: IStockLine,
  daysLeft: number | null,
): INotificationEvent {
  return {
    rule,
    subjectKey: line.productId,
    fingerprint: rule,
    marketplace: null,
    ...NOTIFICATION_TEXT.stock({
      rule,
      label: line.label,
      available: line.available,
      unitsPerDay: line.unitsPerDay,
      daysLeft,
    }),
  };
}

/** Правила, которые считаются по складу, — для пропуска при сбое сборки. */
export const STOCK_RULES: readonly TNotificationRule[] = [
  NOTIFICATION_RULE.OUT_OF_STOCK,
  NOTIFICATION_RULE.LOW_STOCK,
  NOTIFICATION_RULE.STOCK_RUNNING_OUT,
  NOTIFICATION_RULE.PURCHASE_NEEDED,
  NOTIFICATION_RULE.STALE_STOCK,
  NOTIFICATION_RULE.STOCK_VALUE_HIGH,
];
