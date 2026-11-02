import type { IOzonNotificationUrl, IOzonPushType } from './ozon.client';

/**
 * Подписка на push-уведомления Ozon через Seller API (решение
 * `ozon_push_subscribe_via_api`). Чистые правила: что сейчас подключено и что
 * сделать, чтобы уведомления о заказах шли на наш адрес. Чужое не трогаем:
 * у типа уведомления один адрес, и «перехватить» его у другой интеграции
 * продавца значило бы молча сломать её.
 */

/** Типы, после которых меняется свой склад: новое отправление и отмена (только FBS/rFBS). */
export const OZON_PUSH_ORDER_TYPES: readonly string[] = [
  'TYPE_NEW_POSTING',
  'TYPE_POSTING_CANCELLED',
];

export type TOzonPushState =
  /** Наш адрес подключён на оба типа. `availability` — GREEN / YELLOW / RED / ''. */
  | { state: 'connected'; availability: string; enabled: boolean; disableReason: string }
  /** Тип уже идёт на чужой адрес — показываем только хост. */
  | { state: 'occupied'; host: string }
  /** Нашего адреса нет или он старый (сменили секрет) / не на всех типах. */
  | { state: 'none' };

export type TOzonPushAction = { kind: 'set' } | { kind: 'update'; id: string } | { kind: 'none' };

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'другой адрес';
  }
}

/**
 * Состояние и действие. `ourPrefix` — `<PUBLIC_BASE_URL>/api/webhooks/ozon/`: наш
 * адрес узнаётся по нему (флага в базе нет), `ourUrl` — адрес с текущим секретом.
 */
export function planOzonPush(
  urls: readonly IOzonNotificationUrl[],
  pushTypes: readonly IOzonPushType[],
  ourUrl: string,
  ourPrefix: string,
): { status: TOzonPushState; action: TOzonPushAction } {
  const foreign = pushTypes.find(
    (type) =>
      OZON_PUSH_ORDER_TYPES.includes(type.type) &&
      type.endpointUrl !== null &&
      !type.endpointUrl.startsWith(ourPrefix),
  );
  if (foreign?.endpointUrl) {
    return {
      status: { state: 'occupied', host: hostOf(foreign.endpointUrl) },
      action: { kind: 'none' },
    };
  }
  const ours = urls.find((url) => url.url.startsWith(ourPrefix));
  if (!ours) return { status: { state: 'none' }, action: { kind: 'set' } };
  const complete =
    ours.url === ourUrl && OZON_PUSH_ORDER_TYPES.every((type) => ours.types.includes(type));
  if (!complete) return { status: { state: 'none' }, action: { kind: 'update', id: ours.id } };
  return {
    status: {
      state: 'connected',
      availability: ours.availability,
      enabled: ours.enabled,
      disableReason: ours.disableReason,
    },
    action: { kind: 'none' },
  };
}
