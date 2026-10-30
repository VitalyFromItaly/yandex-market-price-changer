import type { TMarketplace } from '../../../shared/marketplace';
import type { IPriceFileBadRow } from '../../price-set/price-set-file';
import type {
  IPriceSetRequest,
  TPriceSetBlock,
  TPriceSetSkip,
  TPriceSetSource,
} from '../../price-set/price-set.domain';
import type { IPriceSetPlanResult } from '../../price-set/price-set.service';

import { MARKETPLACES, MARKETPLACE_LABEL } from '../../../shared/marketplace';
import { PRICE_FILE_BAD_TEXT } from '../../price-set/price-set-file';
import {
  PRICE_SET_BLOCK_TEXT,
  PRICE_SET_MARKUP_MAX,
  PRICE_SET_MARKUP_MIN,
  PRICE_SET_RISKY_DELTA,
  PRICE_SET_SKIP_TEXT,
  isMarkupPercent,
  priceSetRowKey,
} from '../../price-set/price-set.domain';

/**
 * «Установка цен» CRM (TASK-202) — доставка. План считает лист
 * `price-set/price-set.domain.ts`, здесь разбор входа, тексты и поля ответа.
 */

export const PRICE_SET_KIND = 'price-set:plan';
export const PRICE_SET_APPLY_KIND = 'price-set:apply';

export const PRICE_SET_RUNNING = 'PRICE_SET_RUNNING';
export const PRICE_SET_RUNNING_TEXT = 'Запись цен уже идёт — дождитесь её итога.';
export const PLAN_RUNNING = 'PLAN_RUNNING';
export const PLAN_RUNNING_TEXT = 'План цен уже считается — дождитесь его.';
export const WRITE_CLOSED = 'WRITE_CLOSED';
export const WRITE_CLOSED_TEXT =
  'Запись цен закрыта: её открывает администратор отдельно для каждой площадки.';
export const INVALID_PLAN = 'INVALID_PLAN';
export const INVALID_PLAN_TEXT =
  'План не найден или устарел — пересчитайте его и подтвердите ещё раз.';
export const INVALID_MARKETPLACES = 'INVALID_MARKETPLACES';
export const INVALID_MARKETPLACES_TEXT = 'Не выбрано, на какие площадки записать цены.';
export const INVALID_MARKUP = 'INVALID_MARKUP';
export const INVALID_MARKUP_TEXT =
  `Наценка — процент от закупа от ${PRICE_SET_MARKUP_MIN} до ${PRICE_SET_MARKUP_MAX} ` +
  'хотя бы для одной площадки.';
export const INVALID_EXCLUDED = 'INVALID_EXCLUDED';
export const INVALID_EXCLUDED_TEXT = 'Список снятых строк не разобрался — обновите страницу.';
export const NO_FILE_TEXT = 'Прикрепите файл с ценами.';
export const FILE_EXTENSION_TEXT = 'Файл цен — .xlsx, .xls или .csv.';

/** Файл цен: те же 10 МБ, что у прайса; плюс csv — его чаще всего и выгружают. */
export const PRICE_FILE_EXTENSIONS: readonly string[] = ['.xlsx', '.xls', '.csv'];

export function priceFileExtensionOk(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return PRICE_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export const PRICE_SET_NOTES: readonly string[] = [
  '«250%» от закупа — закуп × 2,5: 1000 ₽ → 2500 ₽. Закуп — цена из последнего прайса как есть.',
  'Цена округляется до целого рубля. Зачёркнутая цена и скидка не меняются; на WB базовая цена ' +
    'подбирается так, чтобы с текущей скидкой вышла нужная.',
  `Изменение больше ${Math.round(PRICE_SET_RISKY_DELTA * 100)}% или без текущей цены — строка ` +
    'подсвечена и по умолчанию снята.',
  'Записываются только товары, у которых на площадке уже есть карточка.',
];

/** План по наценке: `{ markups: { ym?: 250, ozon?: 300 } }` → запрос; плохое — null. */
export function parseMarkups(value: unknown): IPriceSetRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const percents: Partial<Record<TMarketplace, number>> = {};
  for (const [key, percent] of Object.entries(value)) {
    if (percent === undefined || percent === null || percent === '') continue;
    if (!isMarketplace(key) || !isMarkupPercent(percent)) return null;
    percents[key] = percent;
  }
  const marketplaces = MARKETPLACES.filter((mp) => percents[mp] !== undefined);
  return marketplaces.length ? { desired: { source: 'markup', percents }, marketplaces } : null;
}

/**
 * Площадки из тела или multipart-поля (`"ym,ozon"` / JSON-массив / массив).
 * `undefined` — поля нет; `null` — мусор или пусто.
 */
export function parseMarketplaces(value: unknown): TMarketplace[] | null | undefined {
  if (value === undefined) return undefined;
  let list: unknown = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    list = trimmed.startsWith('[') ? safeJson(trimmed) : trimmed.split(',').map((s) => s.trim());
  }
  if (!Array.isArray(list) || !list.length || !list.every(isMarketplace)) return null;
  return MARKETPLACES.filter((mp) => (list as string[]).includes(mp));
}

/** Отпечаток плана — sha256 в hex. */
export function parsePlanHash(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : null;
}

export function parsePlanJobId(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

/** Снятые строки — ключи `площадка:артикул`; нет поля — ничего не снято. */
export function parseExcluded(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  if (!value.every((key) => typeof key === 'string' && key.length <= 300)) return null;
  return value as string[];
}

function isMarketplace(value: unknown): value is TMarketplace {
  return typeof value === 'string' && (MARKETPLACES as readonly string[]).includes(value);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export interface ICrmPriceSetRow {
  /** Ключ строки для снятия галочки и для apply. */
  key: string;
  sku: string;
  mpSku: string;
  name: string | null;
  from: number | null;
  to: number;
  /** Δ в процентах, до десятых; null — сравнить не с чем. */
  deltaPct: number | null;
  risky: boolean;
}

export interface ICrmPriceSetTarget {
  marketplace: TMarketplace;
  marketplaceLabel: string;
  blockedBy: TPriceSetBlock | null;
  blockedText: string | null;
  error: string | null;
  updates: ICrmPriceSetRow[];
  unchanged: number;
  skipped: { sku: string; name: string | null; reason: TPriceSetSkip; reasonText: string }[];
  /** Будет ли площадка записана кнопкой: запись открыта, нет блокировки, есть изменения. */
  willWrite: boolean;
}

export interface ICrmPriceSet {
  takenAt: string;
  source: TPriceSetSource;
  planHash: string;
  priceListAt: string | null;
  /** Открыта ли продавцу кнопка записи: хоть одна фича `price_set_write_*`. */
  writeOpen: boolean;
  /** Сколько строк уйдёт в запись, если ничего не снимать (risky сняты фронтом). */
  writeCount: number;
  notes: readonly string[];
  notConsidered: { marketplaceLabel: string; reason: string }[];
  /** Строки файла, которые не разобрались. */
  fileBad: { row: number; sku: string | null; reasonText: string }[];
  targets: ICrmPriceSetTarget[];
  /**
   * Запрос плана — для `apply`, который пересчитает план по нему. Веб его не
   * читает: apply берёт запрос из сохранённого результата по `planJobId`.
   */
  request: IPriceSetRequest;
}

export function toCrmPriceSet(
  result: IPriceSetPlanResult,
  context: {
    now: Date;
    writeOpen: Readonly<Record<TMarketplace, boolean>>;
    fileBad?: readonly IPriceFileBadRow[];
  },
): ICrmPriceSet {
  const targets = result.plan.targets.map((target): ICrmPriceSetTarget => {
    const willWrite =
      context.writeOpen[target.marketplace] &&
      target.blockedBy === null &&
      target.updates.length > 0;
    return {
      marketplace: target.marketplace,
      marketplaceLabel: MARKETPLACE_LABEL[target.marketplace],
      blockedBy: target.blockedBy,
      blockedText: target.blockedBy ? PRICE_SET_BLOCK_TEXT[target.blockedBy] : null,
      error: result.readErrors[target.marketplace] ?? null,
      updates: target.updates.map((row) => ({
        key: priceSetRowKey(target.marketplace, row.mpSku),
        sku: row.sku,
        mpSku: row.mpSku,
        name: row.name,
        from: row.from,
        to: row.to,
        deltaPct: row.delta === null ? null : Math.round(row.delta * 1000) / 10,
        risky: row.risky,
      })),
      unchanged: target.unchanged,
      skipped: target.skipped.map((row) => ({
        ...row,
        reasonText: PRICE_SET_SKIP_TEXT[row.reason],
      })),
      willWrite,
    };
  });
  return {
    takenAt: context.now.toISOString(),
    source: result.plan.source,
    planHash: result.plan.planHash,
    priceListAt: result.priceListAt,
    writeOpen: Object.values(context.writeOpen).some(Boolean),
    writeCount: targets
      .filter((target) => target.willWrite)
      .reduce((sum, target) => sum + target.updates.filter((row) => !row.risky).length, 0),
    notes: PRICE_SET_NOTES,
    notConsidered: result.notConsidered.map(({ marketplace, reason }) => ({
      marketplaceLabel: MARKETPLACE_LABEL[marketplace],
      reason,
    })),
    fileBad: (context.fileBad ?? []).map((row) => ({
      row: row.row,
      sku: row.sku,
      reasonText: PRICE_FILE_BAD_TEXT[row.reason],
    })),
    targets,
    request: result.request,
  };
}
