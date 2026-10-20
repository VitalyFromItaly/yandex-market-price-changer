/**
 * Классификатор статей операций Ozon (/v3/finance/transaction/list, TASK-131) —
 * аналог `ym-articles.ts`.
 *
 * Операция Ozon — не строка, а сумма составляющих: `accruals_for_sale`
 * (выручка или её возврат), `sale_commission`, `delivery_charge`,
 * `return_delivery_charge` и список `services[]` с названием и ценой. Поэтому
 * статья ставится не операции, а каждой составляющей, и операция ложится в
 * журнал одной строкой с расшифровкой (`breakdown`, решение владельца
 * 2026-10-18). Операция без составляющих (хранение, реклама, компенсация)
 * получает статью по своему `operation_type`.
 *
 * Сравнение — точное, как у ЯМ: подстрочное «содержит Return» отнесло бы новую
 * услугу к обратной логистике молча. Незнакомое — `unknown`, и импорт шлёт
 * алерт. Таблицы стартовые: официальная документация Ozon автоматике не
 * отдаётся, имена услуг — из Go-клиента `diphantxm/ozon-api-client`
 * (`common.go`), типы операций — по документации, на живом ответе не сверены
 * (known-gaps).
 *
 * Лист: импортирует только тип статьи.
 */

import type { TFinanceArticle } from './finance-articles';

/** Продажа: выручка за доставленный покупателю товар — двигает товар со склада. */
export const OZON_SALE_TYPES: ReadonlySet<string> = new Set(['OperationAgentDeliveredToCustomer']);

/**
 * Возврат денег покупателю: невыкуп, отмена, возврат после выкупа и сторно
 * доставки. Товар возвращается — себестоимость сторнируется.
 */
export const OZON_RETURN_TYPES: ReadonlySet<string> = new Set([
  'ClientReturnAgentOperation',
  'OperationAgentStornoDeliveredToCustomer',
]);

/** Тип операции без составляющих → статья. */
const BY_OPERATION_TYPE: ReadonlyMap<string, TFinanceArticle> = new Map<string, TFinanceArticle>([
  ['OperationMarketplaceServiceStorage', 'storage'],
  ['OperationMarketplaceServiceStorageFbs', 'storage'],
  ['DisposalReasonFailedToPickupOnTime', 'storage'],
  ['DisposalReasonDamagedPackaging', 'storage'],
  ['MarketplaceRedistributionOfAcquiringOperation', 'acquiring'],
  ['MarketplaceMarketingActionCostOperation', 'promotion'],
  ['OperationPromotionWithCostPerOrder', 'promotion'],
  ['OperationMarketplaceCostPerClick', 'promotion'],
  ['OperationElectronicServiceStencil', 'promotion'],
  ['MarketplaceSaleReviewsOperation', 'promotion'],
  ['OperationPointsForReviews', 'promotion'],
  ['OperationMarketplaceServicePremiumCashbackIndividualPoints', 'promotion'],
  ['OperationMarketplaceServicePremiumPromotion', 'promotion'],
  ['OperationSubscriptionPremium', 'subscription'],
  ['OperationItemReturn', 'reverse_logistics'],
  ['OperationReturnGoodsFBSofRMS', 'reverse_logistics'],
  ['MarketplaceSellerCompensationOperation', 'compensations'],
  ['AccrualInternalClaim', 'compensations'],
  ['OperationLackWriteOff', 'compensations'],
  ['OperationMarketplaceWithHoldingForUndeliverableGoods', 'withholdings'],
  ['OperationMarketplaceCrossDockServiceWriteOff', 'acceptance'],
  ['OperationMarketplaceAgencyFeeAggregator3PLGlobal', 'commission'],
  ['OperationDefectiveWriteOff', 'penalties'],
]);

/** Название услуги из `services[].name` → статья. */
const BY_SERVICE: ReadonlyMap<string, TFinanceArticle> = new Map<string, TFinanceArticle>([
  // Сборка и приём отправления.
  ['MarketplaceServiceItemFulfillment', 'processing'],
  ['MarketplaceServiceItemPickup', 'processing'],
  ['MarketplaceServiceItemDropoffFF', 'processing'],
  ['MarketplaceServiceItemDropoffPVZ', 'processing'],
  ['MarketplaceServiceItemDropoffSC', 'processing'],
  ['MarketplaceServiceItemDropoffPPZ', 'processing'],
  // Прямая логистика до покупателя.
  ['MarketplaceServiceItemDirectFlowTrans', 'delivery_to_buyer'],
  ['MarketplaceServiceItemDirectFlowLogistic', 'delivery_to_buyer'],
  ['MarketplaceServiceItemDelivToCustomer', 'delivery_to_buyer'],
  ['MarketplaceServiceItemDeliveryKGT', 'delivery_to_buyer'],
  ['MarketplaceDeliveryCostItem', 'delivery_to_buyer'],
  // Обратная логистика: невыкуп, отмена, возврат.
  ['MarketplaceServiceItemReturnFlowTrans', 'reverse_logistics'],
  ['MarketplaceServiceItemReturnFlowLogistic', 'reverse_logistics'],
  ['MarketplaceServiceItemReturnAfterDelivToCustomer', 'reverse_logistics'],
  ['MarketplaceServiceItemReturnNotDelivToCustomer', 'reverse_logistics'],
  ['MarketplaceServiceItemReturnPartGoodsCustomer', 'reverse_logistics'],
  ['MarketplaceServiceItemRedistributionReturnsPVZ', 'reverse_logistics'],
  ['MarketplaceServiceItemReturnFromStock', 'reverse_logistics'],
  ['MarketplaceNotDeliveredCostItem', 'reverse_logistics'],
  // Эквайринг.
  ['MarketplaceRedistributionOfAcquiringOperation', 'acquiring'],
  // Хранение.
  ['OperationMarketplaceServiceStorage', 'storage'],
  ['MarketplaceReturnStorageServiceAtThePickupPointFbsItem', 'storage'],
  ['MarketplaceReturnStorageServiceInTheWarehouseFbsItem', 'storage'],
  // Продвижение.
  ['MarketplaceMarketingActionCostItem', 'promotion'],
  ['ItemAdvertisementForSupplierLogistic', 'promotion'],
  ['ItemAdvertisementForSupplierLogisticSeller', 'promotion'],
  ['MarketplaceSaleReviewsItem', 'promotion'],
  ['MarketplaceServicePremiumCashbackIndividualPoints', 'promotion'],
  ['MarketplaceServicePremiumPromotion', 'promotion'],
  // Платные опции.
  ['MarketplaceServiceItemInstallment', 'paid_options'],
  ['MarketplaceServiceItemFlexiblePaymentSchedule', 'paid_options'],
  ['MarketplaceServiceItemMarkingItems', 'paid_options'],
  // Подписка.
  ['ItemAgentServiceStarsMembership', 'subscription'],
  // Удержания и агентское вознаграждение.
  ['OperationMarketplaceWithHoldingForUndeliverableGoods', 'withholdings'],
  ['OperationMarketplaceAgencyFeeAggregator3PLGlobal', 'commission'],
]);

/** Статья операции, у которой нет составляющих, — по её типу. */
export function ozonOperationTypeArticle(operationType: string): TFinanceArticle {
  return BY_OPERATION_TYPE.get(operationType.trim()) ?? 'unknown';
}

/** Статья услуги из `services[]`. */
export function ozonServiceArticle(name: string): TFinanceArticle {
  return BY_SERVICE.get(name.trim()) ?? 'unknown';
}

/**
 * Статья `accruals_for_sale`: выручка у продажи, возврат выручки у возврата.
 * У операции другого типа выручка — незнакомое (`unknown` и алерт), а не
 * угаданная продажа: выручка без движения товара исказила бы себестоимость.
 */
export function ozonAccrualArticle(operationType: string): TFinanceArticle {
  const type = operationType.trim();
  if (OZON_SALE_TYPES.has(type)) return 'sales';
  if (OZON_RETURN_TYPES.has(type)) return 'returns';
  return 'unknown';
}

/** Составляющие операции, у которых своя колонка ответа, → статья. */
export const OZON_COMPONENT_ARTICLE = {
  sale_commission: 'commission',
  delivery_charge: 'delivery_to_buyer',
  return_delivery_charge: 'reverse_logistics',
} as const satisfies Record<string, TFinanceArticle>;

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
