/**
 * Уведомления площадок о заказах (решение `stock_push_on_marketplace_event`) —
 * чистые правила без Nest. Площадка шлёт POST на адрес продавца, мы отвечаем
 * сразу и ставим проход «Передачи остатков»; сам пересчёт идёт в очереди.
 *
 * - ЯМ — API-уведомления Partner API: `{notificationType, campaignId, orderId, …}`,
 *   проверка адреса — `PING` с ответом за 1 с. Пока ответ не 200, Маркет держит
 *   ВСЕ следующие уведомления, а через 14 дней отключает подписку — поэтому на
 *   любое корректное уведомление, даже ненужное нам, отвечаем 200.
 * - Ozon — push-уведомления Seller API 2.1: `{message_type, seller_id, posting_number, …}`,
 *   проверка — `TYPE_PING`; ответ тот же `{version, name, time}`, ошибка —
 *   `{error: {code, message, details}}`. Ozon приостанавливает всё, если 200 меньше
 *   половины или обработка дольше 5 с. Подписку ставим сами (`OzonPushService`).
 * - У WB уведомлений о заказах нет: только расписание.
 */

import { BlockList } from 'node:net';

import { OZON_PUSH_ORDER_TYPES } from '../ozon/ozon-push.domain';

export type TEventMarketplace = 'ym' | 'ozon';

export const EVENT_MARKETPLACES: Readonly<Record<TEventMarketplace, true>> = {
  ym: true,
  ozon: true,
};

export function isEventMarketplace(value: unknown): value is TEventMarketplace {
  return (
    typeof value === 'string' && Object.prototype.hasOwnProperty.call(EVENT_MARKETPLACES, value)
  );
}

/**
 * Подсети, с которых площадки шлют уведомления, — из их документации: ЯМ —
 * «API-уведомления», Ozon — «Push-уведомления» (Seller API 2.1). Подписи у
 * уведомлений нет, поэтому IP — вторая проверка рядом с секретом адреса.
 */
export const EVENT_SOURCE_NETWORKS: Readonly<
  Record<TEventMarketplace, readonly [string, number][]>
> = {
  ym: [
    ['5.45.207.0', 25],
    ['141.8.142.0', 25],
    ['5.255.253.0', 25],
  ],
  ozon: [
    ['195.34.21.0', 24],
    ['185.73.192.0', 22],
    ['91.223.93.0', 24],
  ],
};

const SOURCE_LISTS: Record<TEventMarketplace, BlockList> = {
  ym: listOf(EVENT_SOURCE_NETWORKS.ym),
  ozon: listOf(EVENT_SOURCE_NETWORKS.ozon),
};

function listOf(networks: readonly [string, number][]): BlockList {
  const list = new BlockList();
  for (const [address, prefix] of networks) list.addSubnet(address, prefix, 'ipv4');
  return list;
}

/** IP из сети площадки. `::ffff:1.2.3.4` — тот же IPv4; IPv6 площадки не публикуют — нет. */
export function isEventSourceAllowed(
  marketplace: TEventMarketplace,
  ip: string | undefined,
): boolean {
  const v4 = (ip ?? '').replace(/^::ffff:/i, '');
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) return false;
  return SOURCE_LISTS[marketplace].check(v4, 'ipv4');
}

/**
 * Что пришло: проверка адреса, событие, меняющее свой склад (новый заказ или
 * отмена — продажа вычитается или перестаёт), или что-то, что проход не меняет.
 */
export type TMarketplaceEvent =
  | { kind: 'ping' }
  | { kind: 'stock'; campaignId?: string; sellerId?: string }
  | { kind: 'ignored'; type: string }
  | { kind: 'invalid' };

/** Типы ЯМ, после которых свой склад другой: заказ создан — минус, отменён — плюс. */
const YM_STOCK_EVENTS: readonly string[] = ['ORDER_CREATED', 'ORDER_CANCELLED'];
/** Типы Ozon, то же правило; FBO у Ozon — свои типы, на них не подписываемся. */
const OZON_STOCK_EVENTS = OZON_PUSH_ORDER_TYPES;

function textOf(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

export function parseMarketplaceEvent(
  marketplace: TEventMarketplace,
  body: unknown,
): TMarketplaceEvent {
  if (!body || typeof body !== 'object') return { kind: 'invalid' };
  const raw = body as Record<string, unknown>;
  if (marketplace === 'ym') {
    const type = textOf(raw.notificationType);
    if (!type) return { kind: 'invalid' };
    if (type === 'PING') return { kind: 'ping' };
    if (!YM_STOCK_EVENTS.includes(type)) return { kind: 'ignored', type };
    const campaignId = textOf(raw.campaignId);
    return campaignId ? { kind: 'stock', campaignId } : { kind: 'invalid' };
  }
  const type = textOf(raw.message_type);
  if (!type) return { kind: 'invalid' };
  if (type === 'TYPE_PING') return { kind: 'ping' };
  if (!OZON_STOCK_EVENTS.includes(type)) return { kind: 'ignored', type };
  const sellerId = textOf(raw.seller_id);
  return sellerId ? { kind: 'stock', sellerId } : { kind: 'stock' };
}

/**
 * Ответ на уведомление — одна форма для ЯМ и Ozon: `{version, name, time}`, его
 * ждут на проверку адреса, и на остальное он тоже годится.
 */
export function eventAckOf(now: Date): { version: string; name: string; time: string } {
  return { version: '1.0', name: 'yandex-market-price-changer', time: now.toISOString() };
}

/**
 * Окно склейки: заказы приходят пачками, а проход читает все площадки. События
 * одного окна дают один проход в его конце; следующее окно — следующий проход.
 * Два окна, а не «тот же jobId, пока ждёт»: событие во время идущего прохода
 * Bull с тем же id молча выбросил бы, и заказ ждал бы расписания.
 */
export const STOCK_PUSH_EVENT_WINDOW_MS = 2 * 60_000;

/** Окно события и сколько ждать до его конца. */
export function eventWindowOf(now: number): { window: number; delayMs: number } {
  const window = Math.floor(now / STOCK_PUSH_EVENT_WINDOW_MS);
  return { window, delayMs: (window + 1) * STOCK_PUSH_EVENT_WINDOW_MS - now };
}

/** Начало наших адресов площадки — по нему узнаём свою подписку Ozon среди чужих. */
export function webhookPrefixOf(baseUrl: string, marketplace: TEventMarketplace): string {
  return `${baseUrl}/api/webhooks/${marketplace}/`;
}

/** Адрес уведомлений продавца; null — PUBLIC_BASE_URL не задан. */
export function webhookUrlOf(
  baseUrl: string | null,
  marketplace: TEventMarketplace,
  secret: string,
): string | null {
  return baseUrl ? `${baseUrl}/api/webhooks/${marketplace}/${secret}` : null;
}
