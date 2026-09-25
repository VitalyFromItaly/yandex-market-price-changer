import type { TFeatureKey, TFeatureMap } from '../telegram/bots/shared/features.domain';

import {
  FEATURE,
  FEATURE_META,
  isFbyOnlyFeature,
  isFeatureKey,
  isFeatureOpen,
} from '../telegram/bots/shared/features.domain';
import { fbyOnlyScreenText, isFby } from '../yandex/stocks/placement';

/**
 * Какие разделы CRM открыты продавцу и почему закрыт маршрут.
 *
 * Чистый модуль — без Nest и Mongo, как `features.domain.ts`, чьё правило
 * (`isFeatureOpen`) здесь и применяется: закрытая в панели фича обязана
 * закрываться в обоих каналах одинаково, иначе CRM становится обходом гейта бота.
 */

/** 403: фича закрыта администратором. */
export const FEATURE_DISABLED = 'FEATURE_DISABLED';
/** 403: экран про склад Маркета, а активный магазин не FBY. */
export const FBY_ONLY = 'FBY_ONLY';

/**
 * Раздел CRM (имя маршрута из `crm/src/navigation.ts`) → фичи, ЛЮБОЙ из которых
 * достаточно, чтобы раздел показать. Пустой список — раздел не гейтится
 * (главная, магазин, настройки, профиль): закрыть их флагом значит запереть
 * продавца снаружи собственных настроек — тот же довод, что у бота.
 *
 * Белый список: раздел, которого здесь нет, фронт НЕ показывает. Забытая строка
 * прячет новый раздел, а не открывает закрытый — безопасное направление дрейфа.
 * Совпадение ключей с `navigation.ts` пинит `crm-features.test.ts`.
 */
export const CRM_SECTIONS: Readonly<Record<string, readonly TFeatureKey[]>> = {
  'ym-dashboard': [],
  'ym-orders': [
    FEATURE.REPORT_SHIPPED_TODAY,
    FEATURE.REPORT_REDEEMED,
    FEATURE.REPORT_RETURNING,
    FEATURE.REPORT_IN_TRANSIT,
  ],
  // Две вкладки — «Прибыль» и «Калькулятор»; раздел нужен, пока открыта хоть одна.
  'ym-profit': [FEATURE.REPORT_PROFIT, FEATURE.TARIFF_CALC],
  // Прайс делает два независимых дела — раздел нужен, пока открыто хоть одно.
  'ym-price-list': [FEATURE.PURCHASE_PRICES, FEATURE.STOCK_UPDATE],
  // Карантин бизнесовый, но раздел живёт в магазине: магазин задаёт кабинет.
  'ym-quarantine': [FEATURE.PRICE_QUARANTINE],
  // Отзывы тоже бизнесовые: магазин задаёт кабинет и токен.
  'ym-feedback': [FEATURE.GOODS_FEEDBACK],
  'ym-payments': [FEATURE.PAYMENTS_REPORT],
  // Шесть отчётов — вкладки одного раздела под одним флагом, как в боте.
  'ym-market-reports': [FEATURE.MARKET_REPORTS],
  'ym-recommendations': [FEATURE.PRICE_RECOMMENDATIONS],
  'ym-offer-cards': [FEATURE.OFFER_CARDS],
  // Оба FBY-only: на не-FBY магазине isFeatureOpen закрывает их по модели.
  'ym-fby': [FEATURE.FBY],
  'ym-warehouses': [FEATURE.WAREHOUSES],
  'ym-schedule': [FEATURE.SCHEDULE],
  'ym-stores': [],
  'ym-settings': [],
  profile: [],
  help: [],
};

/**
 * Разделы ВНУТРИ магазина (`/ym/stores/:store/...`) — отчёты считаются по
 * магазину, открытому в вебе. Остальные — разделы аккаунта: ставки и скидки
 * общие на все магазины продавца, рассылка — про бота. Совпадение со
 * `STORE_NAV` фронта пинит `crm-features.test.ts`.
 */
export const CRM_STORE_SECTIONS: ReadonlySet<string> = new Set([
  'ym-dashboard',
  'ym-orders',
  'ym-profit',
  'ym-price-list',
  'ym-quarantine',
  'ym-feedback',
  'ym-payments',
  'ym-market-reports',
  'ym-recommendations',
  'ym-offer-cards',
  'ym-fby',
  'ym-warehouses',
]);

export type TSectionScope = 'account' | 'store';

/**
 * Разделы, которые показать в навигации, — в порядке таблицы. `scope` сужает
 * до разделов аккаунта (`/auth/me`) или магазина (`/stores/:key`, с моделью
 * ЭТОГО магазина); без него — все.
 */
export function visibleSections(
  features: TFeatureMap,
  placementType?: string | null,
  scope?: TSectionScope,
): string[] {
  return Object.entries(CRM_SECTIONS)
    .filter(([name]) => !scope || CRM_STORE_SECTIONS.has(name) === (scope === 'store'))
    .filter(
      ([, keys]) =>
        keys.length === 0 || keys.some((key) => isFeatureOpen(features, key, placementType)),
    )
    .map(([name]) => name);
}

export interface ICrmFeatureBlock {
  code: typeof FEATURE_DISABLED | typeof FBY_ONLY;
  message: string;
}

/**
 * Почему маршрут закрыт, или null — открыт. Нужны ВСЕ ключи (как в боте:
 * `sch:on:report_profit` требует и рассылки, и отчёта).
 *
 * Неизвестный ключ — закрыто: опечатка в декораторе не должна открывать
 * маршрут всем (довод `isReportEnabled`).
 */
export function featureBlock(
  features: TFeatureMap,
  keys: readonly string[],
  placementType?: string | null,
): ICrmFeatureBlock | null {
  for (const key of keys) {
    if (!isFeatureKey(key)) {
      return { code: FEATURE_DISABLED, message: 'Этот раздел недоступен' };
    }
    if (isFeatureOpen(features, key, placementType)) continue;

    // Модель проверяется раньше флага — как в `isFeatureOpen`: продавцу FBS
    // «напишите администратору» не поможет, поможет только смена магазина.
    if (isFbyOnlyFeature(key) && !isFby(placementType)) {
      return { code: FBY_ONLY, message: fbyOnlyScreenText(placementType, { plain: true }) };
    }
    return { code: FEATURE_DISABLED, message: featureDisabledText(key) };
  }
  return null;
}

/** Та же формулировка, что у `featureGate` бота, — без HTML. */
export function featureDisabledText(key: TFeatureKey): string {
  return (
    `🔒 Возможность «${FEATURE_META[key].label}» сейчас недоступна. ` +
    'Её открывает администратор бота. Напишите ему, если она вам нужна.'
  );
}

/** Нужна ли гварду модель магазина: только если среди ключей есть FBY-only. */
export function needsPlacement(keys: readonly string[]): boolean {
  return keys.some((key) => isFeatureKey(key) && isFbyOnlyFeature(key));
}
