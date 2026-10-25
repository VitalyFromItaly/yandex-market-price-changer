/**
 * Журнал финансовых операций Ozon: ключ дедупа, разбор начисления в строку
 * журнала, сводка нераспознанного. Чистые функции — без Nest и базы; аналог
 * `ym-journal.ts`.
 *
 * Источник — /v1/finance/accrual/by-day (TASK-194). До него был
 * /v3/finance/transaction/list (TASK-131), но Ozon отключил его 8.09.2026. По
 * сверке автора Habr 1086658, `accrual_id` = прежнему `operation_id`, а
 * `total_amount` = прежнему `amount`. Ключ строки от этого не меняется, и
 * повторный импорт периода поверх старых строк даёт upsert, а не дубли (на
 * живом ответе наших продавцов не сверено, known-gaps).
 *
 * Начисление ложится ОДНОЙ строкой (решение владельца 2026-10-18): сумма —
 * `total_amount`, составляющие — частями в `breakdown`, как сводная строка
 * акта ЯМ (TASK-155). Ключ и выплата у начисления одни, а P&L раскладывает
 * части по статьям той же `expandBreakdown`.
 */

import type { IFinanceOperationContext, IFinanceOperationRow } from './finance-journal';
import type { IFinancePeriod } from './finance-period';
import type { IOperationBreakdownPart } from './operation-breakdown';
import type { ErrorReporter } from '../errors/error-reporter.service';

import { financeToday } from './finance-period';
import { kopecksToRub, toKopecks } from './kopecks';
import { OZON_RETURN_TYPES, OZON_SALE_TYPES, ozonAccrualTypeArticle } from './ozon-articles';
import { operationKeyOf } from './ym-journal';

type TRaw = Record<string, unknown>;

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  return typeof value === 'number' ? String(value) : '';
}

/** Пояс из ответа → смещение ISO; без пояса — Москва. */
function offsetOf(zone: string | undefined): string {
  if (!zone) return MSK;
  if (zone === 'Z' || zone.includes(':')) return zone;
  return `${zone.slice(0, 3)}:${zone.slice(3)}`;
}

/** id приходят числами — строкой, чтобы не терять точность и не путать типы. */
export function ozonIdOf(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' ? value.trim() : '';
}

const asObject = (value: unknown): TRaw =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as TRaw) : {};

const asList = (value: unknown): TRaw[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is TRaw => !!item && typeof item === 'object' && !Array.isArray(item),
      )
    : [];

/** Московское время — фиксированный +03:00, как у ЯМ. */
const MSK = '+03:00';
const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Дата операции Ozon → момент. «ГГГГ-ММ-ДД ЧЧ:ММ:СС» без пояса — время по
 * Москве (так его показывает кабинет); с поясом — как пришло. Мусор и
 * несуществующий день (2026-02-31) → null.
 */
export function parseOzonDateTime(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const m = DATE_TIME.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00', frac = '', zone] = m;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${frac}${offsetOf(zone)}`);
  if (Number.isNaN(date.getTime())) return null;
  if (!zone && financeToday(date) !== `${y}-${mo}-${d}`) return null;
  return date;
}

/** id начисления — ключ дедупа Ozon (у ЯМ id нет, у Ozon есть). */
export function ozonAccrualIdOf(raw: TRaw): string {
  return ozonIdOf(raw.accrual_id);
}

/**
 * Ключ операции для базы. Читаемая форма — площадка, id и СУММА: сумма в
 * ключе, потому что неизменяемые поля пишутся только вставкой
 * (`MUTABLE_ON_CONFLICT`), и пересчитанная Ozon сумма с ключом по одному id
 * молча потерялась бы. С суммой в ключе пересчёт — новая строка, а прежняя
 * снимается и попадает в корректировки «изменено», как у ЯМ. Та же операция с
 * той же суммой — тот же ключ, повтор импорта дублей не даёт.
 */
export function ozonOperationKey(operationId: string, amountKopecks: number): string {
  return operationKeyOf(JSON.stringify(['ozon', operationId, amountKopecks]));
}

/** Тип начисления из справочника /v1/finance/accrual/types. */
export interface IOzonAccrualType {
  id: string;
  /** Английский код (`Acquiring`, `LastMile`) — по нему ставится статья. */
  name: string;
  /** Русское название — для `serviceName` строки. */
  description: string;
}

/** Справочник типов: `type_id` строкой → тип. */
export type TOzonAccrualTypes = ReadonlyMap<string, IOzonAccrualType>;

/** Справочник списком → карта по id. */
export function ozonAccrualTypesMap(types: readonly IOzonAccrualType[]): TOzonAccrualTypes {
  return new Map(types.map((type) => [type.id, type]));
}

/** Сумма `{amount, currency}` → копейки; поля нет — null. */
const moneyOf = (value: unknown): number | null => toKopecks(asObject(value).amount);

/** Сбор с `type_id` и `accrued` — у доставки, товара, продавца и контейнера. */
interface IOzonFee {
  typeId: string;
  kopecks: number | null;
}

function feesOf(list: unknown): IOzonFee[] {
  return asList(list).map((fee) => ({
    typeId: ozonIdOf(fee.type_id),
    kopecks: moneyOf(fee.accrued),
  }));
}

/** Все сборы начисления — кроме выручки и комиссии отправления, у них свои поля. */
function accrualFees(raw: TRaw): IOzonFee[] {
  const fees: IOzonFee[] = [];
  for (const product of asList(asObject(raw.posting).products)) {
    fees.push(...feesOf(asObject(product.delivery).services));
  }
  for (const item of asList(asObject(raw.item_fees).fees)) fees.push(...feesOf(item.fees));
  const nonItem = asObject(raw.non_item_fee);
  if (Object.keys(nonItem).length) fees.push(...feesOf([nonItem]));
  fees.push(...feesOf(asObject(raw.container_fees).fees));
  return fees;
}

/** Подпись типа в расшифровке: имя из справочника, без него — id. */
function typeLabel(typeId: string, types: TOzonAccrualTypes): string {
  return types.get(typeId)?.name || `type_id ${typeId || '?'}`;
}

/** Выручка отправления: Σ `sale_amount` товаров, копейки. */
function saleKopecks(raw: TRaw): number {
  let total = 0;
  for (const product of asList(asObject(raw.posting).products)) {
    total += moneyOf(asObject(product.commission).sale_amount) ?? 0;
  }
  return total;
}

/**
 * Тип строки (`transactionType`). Своего типа операции у начисления нет —
 * только категория, поэтому у отправления он выводится из знака выручки:
 * плюс — продажа, минус — возврат (так же делит их открытый разбор
 * pavelsur07, сверенный с отчётом о реализации). Он решает движение товара
 * (`ozonGoodsMovement`).
 */
export function ozonAccrualKind(raw: TRaw): string {
  const category = text(raw.accrued_category) || 'UNSPECIFIED';
  if (category !== 'POSTING') return category;
  const sale = saleKopecks(raw);
  if (sale > 0) return 'POSTING_SALE';
  if (sale < 0) return 'POSTING_RETURN';
  return 'POSTING';
}

/**
 * Составляющие начисления по статьям; Σ частей = `total_amount` (остаток —
 * `unknown`). У отправления — выручка каждого товара (`sales` или `returns`
 * по знаку), комиссия `commission.commission` (итоговая, с учётом скидок) и
 * услуги доставки; `bonus` и `coinvestment` — справочные, в сумму начисления
 * не входят и частями не становятся. У остальных — сборы по имени типа.
 */
export function ozonAccrualParts(
  raw: TRaw,
  totalKopecks: number,
  types: TOzonAccrualTypes,
): IOperationBreakdownPart[] {
  const parts: IOperationBreakdownPart[] = [];
  const add = (
    article: IOperationBreakdownPart['article'],
    kopecks: number | null,
    sheet: string,
  ) => {
    if (kopecks) parts.push({ article, kopecks, sheet });
  };

  for (const product of asList(asObject(raw.posting).products)) {
    const commission = asObject(product.commission);
    const sale = moneyOf(commission.sale_amount);
    add(sale !== null && sale < 0 ? 'returns' : 'sales', sale, 'sale_amount');
    add('commission', moneyOf(commission.commission), 'commission');
  }
  for (const fee of accrualFees(raw)) {
    const label = typeLabel(fee.typeId, types);
    add(ozonAccrualTypeArticle(types.get(fee.typeId)?.name), fee.kopecks, label);
  }

  const covered = parts.reduce((sum, part) => sum + part.kopecks, 0);
  if (covered !== totalKopecks) {
    parts.push({ article: 'unknown', kopecks: totalKopecks - covered, sheet: null });
  }
  return parts;
}

/**
 * Статья строки целиком — для чтений, которые берут строку без расшифровки
 * (выплаты, счётчик нераспознанного у статуса периода). Любая нераспознанная
 * часть делает строку `unknown`: иначе счётчик статуса её не увидел бы.
 * Частей нет (начисление на ноль) — статья единственного типа, иначе `unknown`.
 */
function rowArticle(
  raw: TRaw,
  kind: string,
  parts: readonly IOperationBreakdownPart[],
  types: TOzonAccrualTypes,
): IOperationBreakdownPart['article'] {
  if (!parts.length) {
    const names = new Set(accrualFees(raw).map((fee) => types.get(fee.typeId)?.name));
    return names.size === 1 ? ozonAccrualTypeArticle([...names][0]) : 'unknown';
  }
  if (parts.some((part) => part.article === 'unknown')) return 'unknown';
  if (OZON_SALE_TYPES.has(kind)) return 'sales';
  if (OZON_RETURN_TYPES.has(kind)) return 'returns';
  const largest = [...parts].sort((a, b) => Math.abs(b.kopecks) - Math.abs(a.kopecks))[0];
  return largest.article;
}

/** SKU Ozon начисления: товары отправления и товары сборов. */
function accrualSkus(raw: TRaw): string[] {
  const skus: string[] = [];
  for (const product of asList(asObject(raw.posting).products)) skus.push(ozonIdOf(product.sku));
  for (const item of asList(asObject(raw.item_fees).fees)) skus.push(ozonIdOf(item.sku));
  return skus.filter(Boolean);
}

/** Есть ли у начислений SKU — без них каталог для закупа не нужен. */
export function ozonAccrualsHaveSkus(accruals: readonly TRaw[]): boolean {
  return accruals.some((raw) => accrualSkus(raw).length > 0);
}

/**
 * Артикул строки для себестоимости: SKU Ozon позиций → ключ закупа
 * (`skuOf`, решение владельца 2026-10-18 — резолвить при импорте). Один
 * артикул на начисление — он; ни одного или несколько — пусто: делить закуп
 * отправления по догадке нельзя, такая строка честно «без закупа».
 */
function rowSku(raw: TRaw, skuOf: (ozonSku: string) => string | undefined): string | undefined {
  const skus = new Set(accrualSkus(raw).map((ozonSku) => skuOf(ozonSku) ?? ozonSku));
  return skus.size === 1 ? [...skus][0] : undefined;
}

const KIND_NAME: Readonly<Record<string, string>> = {
  POSTING_SALE: 'Продажа',
  POSTING_RETURN: 'Возврат',
  POSTING: 'Отправление',
};

/** Название строки: у отправления — продажа/возврат, у сбора — русское имя его типа. */
function rowServiceName(raw: TRaw, kind: string, types: TOzonAccrualTypes): string | undefined {
  if (KIND_NAME[kind]) return KIND_NAME[kind];
  const ids = new Set(accrualFees(raw).map((fee) => fee.typeId));
  if (ids.size !== 1) return undefined;
  const type = types.get([...ids][0]);
  return type?.description || type?.name || undefined;
}

/** Заказ строки — номер отправления. У сбора продавца `unit_number` — договор, не заказ. */
const ORDER_CATEGORIES: ReadonlySet<string> = new Set(['POSTING', 'ITEM']);

/**
 * Начисление Ozon → строка журнала. Без id, суммы или даты — бросает: это не
 * «начисление на ноль», а форма ответа, которой мы не знаем (довод
 * `nettingRowToOperation`).
 */
export function ozonAccrualToRow(
  raw: TRaw,
  ctx: IFinanceOperationContext,
  types: TOzonAccrualTypes,
  skuOf: (ozonSku: string) => string | undefined = () => undefined,
): IFinanceOperationRow {
  const accrualId = ozonAccrualIdOf(raw);
  if (!accrualId) throw new Error('Начисление Ozon без accrual_id');
  const amountKopecks = moneyOf(raw.total_amount);
  if (amountKopecks === null) throw new Error(`Начисление Ozon ${accrualId} без суммы`);
  const accruedAt = parseOzonDateTime(raw.date);
  if (!accruedAt) throw new Error(`Начисление Ozon ${accrualId} без даты`);

  const kind = ozonAccrualKind(raw);
  const category = text(raw.accrued_category);
  const parts = ozonAccrualParts(raw, amountKopecks, types);
  const article = rowArticle(raw, kind, parts, types);
  const articles = new Set(parts.map((part) => part.article));

  return {
    marketplace: 'ozon',
    telegramUserId: ctx.telegramUserId,
    businessId: ctx.businessId,
    operationKey: ozonOperationKey(accrualId, amountKopecks),
    article,
    direction: amountKopecks < 0 ? 'expense' : 'income',
    amountKopecks,
    orderId: (ORDER_CATEGORIES.has(category) && text(raw.unit_number)) || undefined,
    sku: rowSku(raw, skuOf),
    serviceName: rowServiceName(raw, kind, types),
    transactionType: kind,
    transactionSource: category || undefined,
    accruedAt,
    // FBO — склад Ozon, FBS/RFBS — продавца: схема строки, как `model` у ЯМ.
    model: text(asObject(raw.posting).delivery_schema).toUpperCase() || undefined,
    documentId: ctx.documentId,
    documentVersion: ctx.documentVersion,
    periodKey: ctx.periodKey,
    raw,
    // Одна статья — расшифровка ничего не добавляет: строка и есть эта статья. У
    // нераспознанной строки расшифровка остаётся всегда: по ней алерт называет тип.
    ...(parts.length && (articles.size > 1 || article === 'unknown') ? { breakdown: parts } : {}),
  };
}

/**
 * Начисления, чей день лежит в периоде. Метод берёт ровно день, так что чужих
 * быть не должно; проверка — страховка: начисление на границе легло бы в два
 * месяца, и замена версии одного снимала бы его из другого. Без даты — в
 * `dropped`: разбор всё равно бросит на нём.
 */
export function ozonAccrualsInPeriod(
  raws: readonly TRaw[],
  period: IFinancePeriod,
): { accruals: TRaw[]; dropped: number } {
  const accruals: TRaw[] = [];
  let dropped = 0;
  for (const raw of raws) {
    const at = parseOzonDateTime(raw.date);
    const day = at ? financeToday(at) : null;
    if (day && day >= period.from && day <= period.to) accruals.push(raw);
    else dropped += 1;
  }
  return { accruals, dropped };
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as TRaw)
        .sort()
        .map((key) => [key, sortKeys((value as TRaw)[key])]),
    );
  }
  return value;
}

/**
 * «Оригинал» версии — начисления периода JSON-ом. Файла у метода нет, а версии
 * документа нужен sha256: одинаковый ответ должен давать одинаковые байты,
 * поэтому ключи отсортированы, начисления — по id, и нет ни момента запроса,
 * ни номеров страниц. Иначе каждый прогон заводил бы новую версию.
 *
 * Рядом — имена типов, которые встретились в периоде (`types`): статья сбора
 * взята из справочника, а не из ответа. Новое правило в `ozon-articles.ts` само
 * версию не меняет, но тип, который Ozon переименовал или впервые описал, —
 * меняет, и строки переразберутся. Справочник целиком не кладётся: тип,
 * добавленный Ozon где-то ещё, заводил бы новую версию каждого периода.
 *
 * Рядом — ключи закупа по SKU операций (`purchaseKeys`): артикул строки взят
 * не из ответа Ozon, а из каталога. Каталог не ответил или товар привязали
 * позже — байты другие, версия новая, и `refreshSku` допишет артикул; без
 * этого тот же ответ Ozon дал бы `unchanged`, и сырой SKU остался бы навсегда.
 */
export function ozonFinanceOriginal(
  period: IFinancePeriod,
  accruals: readonly TRaw[],
  types: TOzonAccrualTypes,
  skuOf: (ozonSku: string) => string | undefined = () => undefined,
): Buffer {
  const sorted = [...accruals].sort((a, b) => {
    const x = ozonAccrualIdOf(a);
    const y = ozonAccrualIdOf(b);
    return x.length - y.length || x.localeCompare(y);
  });
  const purchaseKeys: Record<string, string> = {};
  const usedTypes: Record<string, string> = {};
  for (const accrual of sorted) {
    for (const sku of accrualSkus(accrual)) {
      const key = skuOf(sku);
      if (key) purchaseKeys[sku] = key;
    }
    for (const fee of accrualFees(accrual)) {
      if (fee.typeId) usedTypes[fee.typeId] = types.get(fee.typeId)?.name ?? '';
    }
  }
  return Buffer.from(
    JSON.stringify(sortKeys({ period, accruals: sorted, purchaseKeys, types: usedTypes })),
    'utf8',
  );
}

/**
 * Отдельный класс — отдельный `errorType`, половина ключа троттлинга алертов
 * (довод `YmUnknownArticleError`).
 */
export class OzonUnknownArticleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OzonUnknownArticleError';
  }
}

/** Место алерта — без id продавца и периода: иначе троттлинг не сработает никогда. */
export const OZON_UNKNOWN_ARTICLE_CONTEXT = 'finance:ozon-articles';

export interface IOzonUnknownGroup {
  signature: string;
  count: number;
  amountKopecks: number;
}

/**
 * Нераспознанное по подписям: тип сбора без правила, остаток, которому
 * составляющей не нашлось, или начисление без частей. Сумма — нераспознанной
 * части, а не всего начисления.
 */
export function ozonUnknownGroups(ops: readonly IFinanceOperationRow[]): IOzonUnknownGroup[] {
  const groups = new Map<string, IOzonUnknownGroup>();
  const add = (signature: string, kopecks: number) => {
    const group = groups.get(signature) ?? { signature, count: 0, amountKopecks: 0 };
    group.count += 1;
    group.amountKopecks += kopecks;
    groups.set(signature, group);
  };
  for (const op of ops) {
    if (op.article !== 'unknown') continue;
    const type = op.transactionType || '(без типа)';
    const parts = op.breakdown?.length
      ? op.breakdown
      : [{ article: op.article, kopecks: op.amountKopecks, sheet: null }];
    for (const part of parts) {
      if (part.article !== 'unknown') continue;
      if (part.sheet) add(`тип начисления ${part.sheet}`, part.kopecks);
      else if (op.breakdown?.length) add(`остаток без составляющей у ${type}`, part.kopecks);
      else add(`начисление ${type}`, part.kopecks);
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/** Один алерт на загрузку; возвращает число операций без статьи. */
export async function reportOzonUnknownArticles(
  errors: Pick<ErrorReporter, 'report'>,
  ops: readonly IFinanceOperationRow[],
  telegramUserId: string,
): Promise<number> {
  const groups = ozonUnknownGroups(ops);
  if (groups.length) {
    const lines = groups.map(
      (g) => `${g.signature}: ${g.count} шт., ${kopecksToRub(g.amountKopecks)} ₽`,
    );
    await errors.report({
      error: new OzonUnknownArticleError(
        `Журнал Ozon: начисления без статьи — допишите правило в ozon-articles.ts\n${lines.join('\n')}`,
      ),
      source: 'queue',
      context: OZON_UNKNOWN_ARTICLE_CONTEXT,
      telegramUserId,
    });
  }
  return ops.filter((op) => op.article === 'unknown').length;
}
