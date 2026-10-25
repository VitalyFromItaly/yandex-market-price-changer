/**
 * Классификатор статей начислений Ozon (/v1/finance/accrual/by-day, TASK-194;
 * до неё — /v3/finance/transaction/list, TASK-131) — аналог `ym-articles.ts`.
 *
 * Начисление Ozon — не строка, а сумма составляющих: у отправления — выручка
 * (`sale_amount`, со знаком), комиссия и услуги доставки, у остальных —
 * сборы с `type_id`. Поэтому статья ставится не начислению, а каждой
 * составляющей, и начисление ложится в журнал одной строкой с расшифровкой
 * (`breakdown`, решение владельца 2026-10-18).
 *
 * Сбор узнаётся по `name` типа из справочника /v1/finance/accrual/types, а не по
 * `type_id`: имя — смысл, а id — номер в чужой таблице. Сравнение — точное, как у
 * ЯМ: подстрочное «содержит Return» отнесло бы новый тип к обратной логистике
 * молча. Незнакомое и спорное — `unknown`, и импорт шлёт алерт. Таблица —
 * по справочнику из открытого репозитория (pavelsur07/app-service-finance,
 * фикстура accrual_types.json); на живом ответе наших продавцов не сверена
 * (known-gaps).
 *
 * Лист: импортирует только тип статьи.
 */

import type { TFinanceArticle } from './finance-articles';

/**
 * Продажа: выручка за доставленный покупателю товар — двигает товар со склада.
 * Старые строки журнала хранят тип операции /v3 — их `transactionType` при
 * повторном импорте не переписывается (`MUTABLE_ON_CONFLICT`), поэтому здесь
 * оба словаря.
 */
export const OZON_SALE_TYPES: ReadonlySet<string> = new Set([
  'POSTING_SALE',
  'OperationAgentDeliveredToCustomer',
]);

/**
 * Возврат денег покупателю: невыкуп, отмена, возврат после выкупа и сторно
 * доставки. Товар возвращается — себестоимость сторнируется.
 */
export const OZON_RETURN_TYPES: ReadonlySet<string> = new Set([
  'POSTING_RETURN',
  'ClientReturnAgentOperation',
  'OperationAgentStornoDeliveredToCustomer',
]);

/**
 * Имя типа начисления → статья. Спорные типы (CorrectionCommission,
 * RealizationReportCorrection, SetOff, BrandDeposit, Charity, Rfbs*) нарочно
 * не здесь: их смысл без живого ответа не установить, и `unknown` с алертом
 * честнее угаданной статьи.
 */
const BY_TYPE_NAME: ReadonlyMap<string, TFinanceArticle> = new Map<string, TFinanceArticle>([
  // Комиссия.
  ['SaleCommission', 'commission'],
  // Эквайринг.
  ['Acquiring', 'acquiring'],
  // Прямая логистика до покупателя.
  ['Shipment', 'delivery_to_buyer'],
  ['Logistic', 'delivery_to_buyer'],
  ['B2CLogistics', 'delivery_to_buyer'],
  ['InternationalLogisticDelta', 'delivery_to_buyer'],
  ['LastMile', 'delivery_to_buyer'],
  ['LastMileCourier', 'delivery_to_buyer'],
  ['LastMilePickUpPoint', 'delivery_to_buyer'],
  ['DeliveryToHandoverPlaceByOzon', 'delivery_to_buyer'],
  ['B2CDeliveryToHandoverPlaceByOzon', 'delivery_to_buyer'],
  // Сборка и приём отправления.
  ['Drop-Off', 'processing'],
  ['Drop-Off Agent', 'processing'],
  ['B2C Drop-Off', 'processing'],
  ['B2C Drop-Off Agent', 'processing'],
  ['Pick-Up', 'processing'],
  ['PickUpCourierArrangement', 'processing'],
  ['PickUpCourierDelivery', 'processing'],
  ['Fulfillment', 'processing'],
  ['PackageUnitProcessing', 'processing'],
  ['QuantProcessingDrop', 'processing'],
  // Обратная логистика: невыкуп, отмена, возврат.
  ['BackwardShipment', 'reverse_logistics'],
  ['ReturnFlowLogistic', 'reverse_logistics'],
  ['ClientReturn', 'reverse_logistics'],
  ['Cancellation', 'reverse_logistics'],
  ['PartialReturn', 'reverse_logistics'],
  ['PickUpPointReturnAcceptance', 'reverse_logistics'],
  ['B2CPickUpPointReturnAcceptance', 'reverse_logistics'],
  ['PreparingToReturn', 'reverse_logistics'],
  ['B2CBackwardLogistics', 'reverse_logistics'],
  ['RfbsEasyReturn', 'reverse_logistics'],
  // Хранение и утилизация.
  ['Placements', 'storage'],
  ['TemporaryPlacement', 'storage'],
  ['TemporaryPlacementsAgent', 'storage'],
  ['B2CTemporaryPlacement', 'storage'],
  ['ReturnStorageInTheWarehouse', 'storage'],
  ['Disposal', 'storage'],
  ['B2CDisposal', 'storage'],
  // Приёмка.
  ['SupplyInbound', 'acceptance'],
  ['CrossDock', 'acceptance'],
  ['VolumeWeightCharacteristicsProcessing', 'acceptance'],
  ['Replenishment', 'acceptance'],
  // Продвижение.
  ['PayPerClick', 'promotion'],
  ['Promotion', 'promotion'],
  ['Marketing', 'promotion'],
  ['Stencil', 'promotion'],
  ['ExternalPromotion', 'promotion'],
  ['PointsForReviews', 'promotion'],
  ['PremiumCashbackIndividualPoints', 'promotion'],
  ['PremiumCashbackPromotion', 'promotion'],
  ['SaleReview', 'promotion'],
  ['ReviewsPin', 'promotion'],
  ['AcceleratedReviewCollection', 'promotion'],
  ['FirstCustomerReview', 'promotion'],
  ['PushCampaign', 'promotion'],
  // Подписки.
  ['PremiumSubscription', 'subscription'],
  ['PremiumMembership', 'subscription'],
  ['StarsMembership', 'subscription'],
  // Платные опции.
  ['Installment', 'paid_options'],
  ['FlexiblePayments', 'paid_options'],
  ['EarlyPayment', 'paid_options'],
  ['Marking', 'paid_options'],
  // Компенсации.
  ['Compensation', 'compensations'],
  ['ItemCompensation', 'compensations'],
  ['B2CInsuranceCompensation', 'compensations'],
  ['ClaimCommission', 'compensations'],
  ['VolumeObligationReward', 'compensations'],
  // Штрафы.
  ['DefectRate', 'penalties'],
  ['DefectFineModeration', 'penalties'],
  ['DefectFineProhibitedGoods', 'penalties'],
  ['DefectFineCounterfeitGoods', 'penalties'],
  ['DefectFineComplaint', 'penalties'],
  ['DefectFineErrors', 'penalties'],
  ['DefectFineShipmentDelayRate', 'penalties'],
]);

/** Статья сбора по имени его типа; тип вне справочника (имени нет) — `unknown`. */
export function ozonAccrualTypeArticle(name: string | undefined): TFinanceArticle {
  return (name && BY_TYPE_NAME.get(name.trim())) || 'unknown';
}

/** Движение товара операцией Ozon — как `TYmGoodsMovement`. */
export type TOzonGoodsMovement = 'sold' | 'returned' | null;

/**
 * Двигает ли товар строка P&L операции Ozon. Строка — уже часть расшифровки
 * (`expandBreakdown` разложил операцию по статьям), поэтому товар двигает
 * ТОЛЬКО часть выручки: комиссия и логистика той же операции — с тем же id,
 * и сочти мы их, штуки и закуп посчитались бы столько раз, сколько статей.
 */
export function ozonGoodsMovement(
  operationType: string,
  article: TFinanceArticle,
): TOzonGoodsMovement {
  const type = operationType.trim();
  if (article === 'sales' && OZON_SALE_TYPES.has(type)) return 'sold';
  if (article === 'returns' && OZON_RETURN_TYPES.has(type)) return 'returned';
  return null;
}
