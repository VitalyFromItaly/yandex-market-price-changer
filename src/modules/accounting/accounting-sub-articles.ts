/**
 * Подстатьи «Финучёта» (ТЗ п.10, TASK-207): тонкая классификация строки журнала
 * `finance_operations` для нового движка — колонка `sub_article`.
 *
 * Статья (`article`) и её правила (`{ym,ozon,wb}-articles.ts`) не меняются
 * (решение `accounting_same_journal`): текущий P&L читает только статью.
 * Подстатья — второй, более тонкий взгляд на ту же строку: участие в акциях,
 * штрафы отдельно от удержаний, баллы и кэшбэк, утилизация отдельно от
 * хранения, обработка возвратов отдельно от обратной логистики (матрица
 * `docs/accounting-data-matrix.md`, «Противоречия и пробелы», п.2–9).
 *
 * Таблицы — `Record<известный тип, подстатья>`: тип без подстатьи не
 * компилируется, а тесты сверяют ключи с классификаторами статей. Незнакомый
 * тип — `unknown`, никогда не «прочее» (довод `finance-articles.ts`).
 *
 * Вход — только то, что лежит в строке журнала (тип, источник, название
 * услуги, raw, расшифровка), чтобы импорт и бэкфилл по сохранённым строкам
 * давали одно и то же.
 *
 * Лист: импортирует только классификаторы статей (тоже листы).
 */

import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { IOperationBreakdownPart } from '../finance/operation-breakdown';

import { OZON_RETURN_TYPES, OZON_SALE_TYPES } from '../finance/ozon-articles';
import { normalizeYmLabel } from '../finance/ym-articles';

export type TAccountingSubArticle =
  | 'sale'
  | 'return'
  | 'sale_correction'
  | 'storno'
  | 'points_subsidy'
  | 'points_return'
  | 'loss_compensation'
  | 'service_compensation'
  | 'defect_compensation'
  | 'loyalty_compensation'
  | 'pvz_reimbursement'
  | 'advance_payment'
  | 'volume_reward'
  | 'premium'
  | 'commission'
  | 'commission_reversal'
  | 'acquiring'
  | 'delivery'
  | 'middle_mile'
  | 'delivery_reversal'
  | 'delivery_correction'
  | 'transport_reimbursement'
  | 'reverse_logistics'
  | 'return_processing'
  | 'cancellation'
  | 'processing'
  | 'storage'
  | 'return_storage'
  | 'disposal'
  | 'acceptance'
  | 'advertising'
  | 'sales_boost'
  | 'reviews'
  | 'cashback_points'
  | 'promo_participation'
  | 'subscription'
  | 'paid_option'
  | 'penalty'
  | 'withholding'
  | 'act_summary'
  | 'unknown';

export const ACCOUNTING_SUB_ARTICLE_TITLE: Record<TAccountingSubArticle, string> = {
  sale: 'Продажа',
  return: 'Возврат продажи',
  sale_correction: 'Корректировка продажи',
  storno: 'Сторно',
  points_subsidy: 'Баллы площадки (субсидия)',
  points_return: 'Возврат баллов',
  loss_compensation: 'Компенсация утраты или порчи',
  service_compensation: 'Компенсация за услуги',
  defect_compensation: 'Компенсация брака и возврата',
  loyalty_compensation: 'Компенсация скидки лояльности',
  pvz_reimbursement: 'Возмещение за выдачу и возврат на ПВЗ',
  advance_payment: 'Аванс за товар без движения',
  volume_reward: 'Вознаграждение за объём',
  premium: 'Премия',
  commission: 'Комиссия за продажу',
  commission_reversal: 'Возврат комиссии',
  acquiring: 'Эквайринг',
  delivery: 'Доставка покупателю',
  middle_mile: 'Средняя миля',
  delivery_reversal: 'Возврат за доставку',
  delivery_correction: 'Корректировка логистики',
  transport_reimbursement: 'Возмещение издержек по перевозке',
  reverse_logistics: 'Доставка невыкупов и возвратов',
  return_processing: 'Обработка возвратов',
  cancellation: 'Отмена',
  processing: 'Сборка и приём отправлений',
  storage: 'Хранение',
  return_storage: 'Хранение возвратов',
  disposal: 'Утилизация',
  acceptance: 'Приёмка',
  advertising: 'Реклама',
  sales_boost: 'Буст продаж',
  reviews: 'Отзывы',
  cashback_points: 'Баллы и кэшбэк покупателю',
  promo_participation: 'Участие в акциях (справочно)',
  subscription: 'Абонентская плата',
  paid_option: 'Платные опции',
  penalty: 'Штраф',
  withholding: 'Удержание',
  act_summary: 'Сводная строка акта',
  unknown: 'Не распознано',
};

export function isAccountingSubArticle(value: unknown): value is TAccountingSubArticle {
  return typeof value === 'string' && Object.hasOwn(ACCOUNTING_SUB_ARTICLE_TITLE, value);
}

// ─── ЯМ ─────────────────────────────────────────────────────────────────────

/** «Тип · Источник» строки united-netting → подстатья (пары — те же, что в `ym-articles.ts`). */
export const YM_TYPE_SOURCE_SUB = {
  'Начисление · Платёж покупателя': 'sale',
  'Начисление · Баллы за скидку Маркета': 'points_subsidy',
  'Начисление · Баллы за скидку Яндекс Плюс': 'points_subsidy',
  'Возврат · Возврат платежа покупателя': 'return',
  'Возврат · Возврат баллов за скидку Маркета': 'points_return',
  'Возврат · Возврат баллов за скидку Яндекс Плюс': 'points_return',
  'Начисление · Утрата или порча товаров в доставке': 'loss_compensation',
  'Начисление · Утеря или порча отправления заказа': 'loss_compensation',
  'Начисление · Ненадлежащее оказание услуг': 'service_compensation',
  'Начисление · Премия': 'premium',
  'Возврат · Удержание выплаты за утерю или порчу заказа': 'withholding',
  'Возврат · Выплата расходов покупателю при возврате товара ненадлежащего качества': 'withholding',
  'Списание · Скидка за участие в совместных акциях': 'promo_participation',
  'Возврат списания · Возврат скидки за участие в совместных акциях': 'promo_participation',
} as const satisfies Record<string, TAccountingSubArticle>;

/** Удержание · Оплата услуг Маркета → подстатья по названию услуги. */
export const YM_WITHHELD_SERVICE_SUB = {
  'Размещение товарных предложений': 'commission',
  'Доставка покупателю': 'delivery',
  'Доставка (средняя миля)': 'middle_mile',
  'Доставка невыкупов и возвратов': 'reverse_logistics',
  'Приём платежа': 'acquiring',
  'Перевод платежа': 'acquiring',
  'Буст продаж, оплата за продажи': 'sales_boost',
  'Отзывы за баллы': 'reviews',
} as const satisfies Record<string, TAccountingSubArticle>;

/** Начисление · Оплата услуг Маркета — сторно услуги. */
export const YM_REVERSED_SERVICE_SUB = {
  'Скидка за лояльность': 'commission_reversal',
  'Возврат за размещение товаров на витрине': 'commission_reversal',
  'Возврат за доставку покупателю': 'delivery_reversal',
  'Возврат за доставку в населённый пункт или ФО покупателя': 'delivery_reversal',
  'Доставка (средняя миля)': 'middle_mile',
} as const satisfies Record<string, TAccountingSubArticle>;

const YM_SERVICE_SOURCE = normalizeYmLabel('Оплата услуг Маркета');

const ymPair = (type: unknown, source: unknown) =>
  `${normalizeYmLabel(type)}|${normalizeYmLabel(source)}`;

const normalizedMap = (
  table: Readonly<Record<string, TAccountingSubArticle>>,
  key: (label: string) => string,
) => new Map(Object.entries(table).map(([label, sub]) => [key(label), sub]));

const YM_BY_PAIR = normalizedMap(YM_TYPE_SOURCE_SUB, (label) => {
  const [type, source] = label.split(' · ');
  return ymPair(type, source);
});
const YM_WITHHELD = normalizedMap(YM_WITHHELD_SERVICE_SUB, normalizeYmLabel);
const YM_REVERSED = normalizedMap(YM_REVERSED_SERVICE_SUB, normalizeYmLabel);

const isBlank = (value: unknown) => value === null || value === undefined || value === '';

/**
 * Подстатья строки ЯМ. Штрафов ЯМ в карте нет (матрица, п.2): их тип не
 * встречался в журнале, и он уходит в `unknown`, а не в удержания.
 */
export function ymSubArticle(
  transactionType: unknown,
  transactionSource: unknown,
  serviceName: unknown,
): TAccountingSubArticle {
  const direct = YM_BY_PAIR.get(ymPair(transactionType, transactionSource));
  if (direct) return direct;
  if (normalizeYmLabel(transactionSource) !== YM_SERVICE_SOURCE) return 'unknown';
  const type = normalizeYmLabel(transactionType);
  if (type === normalizeYmLabel('Удержание')) {
    if (isBlank(serviceName)) return 'act_summary';
    return YM_WITHHELD.get(normalizeYmLabel(serviceName)) ?? 'unknown';
  }
  if (type === normalizeYmLabel('Начисление')) {
    return YM_REVERSED.get(normalizeYmLabel(serviceName)) ?? 'unknown';
  }
  return 'unknown';
}

// ─── Ozon ───────────────────────────────────────────────────────────────────

/** Тип строки с товаром (`ozonAccrualKind` и старые типы /v3) → продажа или возврат. */
export const OZON_GOODS_KIND_SUB = {
  POSTING_SALE: 'sale',
  OperationAgentDeliveredToCustomer: 'sale',
  POSTING_RETURN: 'return',
  ClientReturnAgentOperation: 'return',
  OperationAgentStornoDeliveredToCustomer: 'return',
} as const satisfies Record<string, TAccountingSubArticle>;

/** Имя типа начисления (справочник /v1/finance/accrual/types) → подстатья. Те же имена, что в `ozon-articles.ts`. */
export const OZON_TYPE_NAME_SUB = {
  SaleCommission: 'commission',
  Acquiring: 'acquiring',
  Shipment: 'delivery',
  Logistic: 'delivery',
  B2CLogistics: 'delivery',
  InternationalLogisticDelta: 'delivery',
  LastMile: 'delivery',
  LastMileCourier: 'delivery',
  LastMilePickUpPoint: 'delivery',
  DeliveryToHandoverPlaceByOzon: 'delivery',
  B2CDeliveryToHandoverPlaceByOzon: 'delivery',
  'Drop-Off': 'processing',
  'Drop-Off Agent': 'processing',
  'B2C Drop-Off': 'processing',
  'B2C Drop-Off Agent': 'processing',
  'Pick-Up': 'processing',
  PickUpCourierArrangement: 'processing',
  PickUpCourierDelivery: 'processing',
  Fulfillment: 'processing',
  PackageUnitProcessing: 'processing',
  QuantProcessingDrop: 'processing',
  BackwardShipment: 'reverse_logistics',
  ReturnFlowLogistic: 'reverse_logistics',
  ClientReturn: 'reverse_logistics',
  Cancellation: 'cancellation',
  PartialReturn: 'reverse_logistics',
  PickUpPointReturnAcceptance: 'return_processing',
  B2CPickUpPointReturnAcceptance: 'return_processing',
  PreparingToReturn: 'return_processing',
  B2CBackwardLogistics: 'reverse_logistics',
  RfbsEasyReturn: 'reverse_logistics',
  Placements: 'storage',
  TemporaryPlacement: 'storage',
  TemporaryPlacementsAgent: 'storage',
  B2CTemporaryPlacement: 'storage',
  ReturnStorageInTheWarehouse: 'return_storage',
  // Матрица, п.9: утилизация у статьи — хранение; здесь — отдельно.
  Disposal: 'disposal',
  B2CDisposal: 'disposal',
  SupplyInbound: 'acceptance',
  CrossDock: 'acceptance',
  VolumeWeightCharacteristicsProcessing: 'acceptance',
  Replenishment: 'acceptance',
  PayPerClick: 'advertising',
  Promotion: 'advertising',
  Marketing: 'advertising',
  Stencil: 'advertising',
  ExternalPromotion: 'advertising',
  PushCampaign: 'advertising',
  PointsForReviews: 'reviews',
  SaleReview: 'reviews',
  ReviewsPin: 'reviews',
  AcceleratedReviewCollection: 'reviews',
  FirstCustomerReview: 'reviews',
  // Матрица, п.5: баллы Ozon — расход продавца (у ЯМ баллы — субсидия).
  PremiumCashbackIndividualPoints: 'cashback_points',
  PremiumCashbackPromotion: 'cashback_points',
  PremiumSubscription: 'subscription',
  PremiumMembership: 'subscription',
  StarsMembership: 'subscription',
  Installment: 'paid_option',
  FlexiblePayments: 'paid_option',
  EarlyPayment: 'paid_option',
  Marking: 'paid_option',
  Compensation: 'loss_compensation',
  ItemCompensation: 'loss_compensation',
  B2CInsuranceCompensation: 'loss_compensation',
  ClaimCommission: 'service_compensation',
  VolumeObligationReward: 'volume_reward',
  DefectRate: 'penalty',
  DefectFineModeration: 'penalty',
  DefectFineProhibitedGoods: 'penalty',
  DefectFineCounterfeitGoods: 'penalty',
  DefectFineComplaint: 'penalty',
  DefectFineErrors: 'penalty',
  DefectFineShipmentDelayRate: 'penalty',
} as const satisfies Record<string, TAccountingSubArticle>;

const OZON_BY_NAME: ReadonlyMap<string, TAccountingSubArticle> = new Map(
  Object.entries(OZON_TYPE_NAME_SUB),
);

/** Части выручки и комиссии отправления — не сборы, имя типа у них не имя. */
const OZON_POSTING_SHEETS: ReadonlySet<string> = new Set(['sale_amount', 'commission']);

/**
 * Подстатья начисления Ozon. Отправление — по знаку выручки (тип строки),
 * сбор — по имени типа самой крупной части. `parts` — расшифровка с именами
 * типов в `sheet` (импорт считает её всегда, в базе она лежит только у
 * многостатейных строк): без частей сбор не узнать — `unknown`.
 */
export function ozonSubArticle(
  transactionType: string,
  parts: readonly Pick<IOperationBreakdownPart, 'kopecks' | 'sheet'>[] | null | undefined,
): TAccountingSubArticle {
  const kind = transactionType.trim();
  const goods = (OZON_GOODS_KIND_SUB as Record<string, TAccountingSubArticle>)[kind];
  if (goods) return goods;
  if (OZON_SALE_TYPES.has(kind)) return 'sale';
  if (OZON_RETURN_TYPES.has(kind)) return 'return';
  const fees = (parts ?? []).filter((part) => part.sheet && !OZON_POSTING_SHEETS.has(part.sheet));
  if (!fees.length) return 'unknown';
  const largest = [...fees].sort((a, b) => Math.abs(b.kopecks) - Math.abs(a.kopecks))[0];
  return OZON_BY_NAME.get(largest.sheet.trim()) ?? 'unknown';
}

// ─── WB ─────────────────────────────────────────────────────────────────────

/** `supplier_oper_name` → подстатья. Ключи — ровно `WB_KNOWN_OPERS` (`wb-articles.ts`). */
export const WB_OPER_SUB = {
  Продажа: 'sale',
  Возврат: 'return',
  'Корректная продажа': 'sale_correction',
  'Корректный возврат': 'sale_correction',
  'Сторно продаж': 'storno',
  'Сторно возвратов': 'storno',
  'Коррекция продаж': 'sale_correction',
  Логистика: 'delivery',
  'Логистика сторно': 'delivery_correction',
  'Коррекция логистики': 'delivery_correction',
  'Возмещение издержек по перевозке': 'transport_reimbursement',
  'Возмещение издержек по перевозке/по складским операциям с товаром': 'transport_reimbursement',
  // Живой импорт 11-2026 (117ebca): типы, которых не было в перечне по памяти.
  Доставка: 'delivery',
  'Возмещение издержек по перемещению и операционной обработке товара': 'transport_reimbursement',
  'Услуга по обработке Товара': 'processing',
  Хранение: 'storage',
  Штраф: 'penalty',
  Штрафы: 'penalty',
  // Матрица, п.6: в удержаниях WB лежит и реклама — без расшифровки WB не отличить.
  Удержание: 'withholding',
  Удержания: 'withholding',
  'Платная приемка': 'acceptance',
  'Платная приёмка': 'acceptance',
  'Компенсация ущерба': 'loss_compensation',
  'Частичная компенсация брака': 'defect_compensation',
  'Добровольная компенсация при возврате': 'defect_compensation',
  'Компенсация подмененного товара': 'loss_compensation',
  'Авансовая оплата за товар без движения': 'advance_payment',
  'Возмещение за выдачу и возврат товаров на ПВЗ': 'pvz_reimbursement',
  'Компенсация скидки по программе лояльности': 'loyalty_compensation',
} as const satisfies Record<string, TAccountingSubArticle>;

const WB_BY_OPER: ReadonlyMap<string, TAccountingSubArticle> = new Map(Object.entries(WB_OPER_SUB));

export function wbSubArticle(supplierOperName: string): TAccountingSubArticle {
  return WB_BY_OPER.get(supplierOperName.trim()) ?? 'unknown';
}

// ─── Колонки реестра ────────────────────────────────────────────────────────

/** Новые колонки реестра ТЗ п.10 — то, что пишет импорт и бэкфилл. */
export interface IAccountingRegistryColumns {
  subArticle: TAccountingSubArticle;
  /** Код валюты — только из явного поля raw; нет поля — null. */
  currency: string | null;
  /** Позиция заказа: ни одна площадка не отдаёт её в строке журнала (матрица, п.20). */
  itemId: string | null;
  /** Дата отражения в отчёте: явного поля нет ни у кого (матрица, п.20). */
  reportedAt: Date | null;
  /** Статус обработки: у площадок его нет, свой заводит новый движок. */
  processingStatus: string | null;
}

/** Что из строки журнала нужно классификатору — то же у импорта и у сохранённой строки. */
export interface IAccountingRowInput {
  marketplace: TFinanceMarketplace;
  transactionType: string;
  transactionSource?: string | null;
  serviceName?: string | null;
  raw: Record<string, unknown>;
  /** Ozon: расшифровка с именами типов в `sheet`. */
  parts?: readonly Pick<IOperationBreakdownPart, 'kopecks' | 'sheet'>[] | null;
}

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const currencyCode = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
};

/**
 * Валюта строки — только явное поле raw: Ozon несёт `{amount, currency}` в
 * `total_amount`, у WB в отчёте реализации бывает `currency_name`. У ЯМ поля
 * нет — null, а не «RUB по умолчанию»: выдуманное значение спрятало бы, что
 * площадка валюту не назвала.
 */
function currencyOf(input: IAccountingRowInput): string | null {
  if (input.marketplace === 'ozon') return currencyCode(asObject(input.raw.total_amount).currency);
  if (input.marketplace === 'wb') return currencyCode(input.raw.currency_name);
  return null;
}

function subArticleOf(input: IAccountingRowInput): TAccountingSubArticle {
  switch (input.marketplace) {
    case 'ym':
      return ymSubArticle(input.transactionType, input.transactionSource, input.serviceName);
    case 'ozon':
      return ozonSubArticle(input.transactionType, input.parts);
    case 'wb':
      return wbSubArticle(input.transactionType);
    default:
      return 'unknown';
  }
}

/** Колонки реестра для строки журнала. Чистая функция: импорт и бэкфилл дают одно и то же. */
export function accountingColumnsOf(input: IAccountingRowInput): IAccountingRegistryColumns {
  return {
    subArticle: subArticleOf(input),
    currency: currencyOf(input),
    itemId: null,
    reportedAt: null,
    processingStatus: null,
  };
}
