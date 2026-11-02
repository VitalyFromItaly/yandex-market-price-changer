import type { TMarketplace } from '../../../shared/marketplace';
import type { IStockPushPlan, TStockPushBlock, TStockPushSkip } from '../../finance/stock-push';
import type { TOzonPushState } from '../../ozon/ozon-push.domain';
import type { TPushInterval } from '../../stock-push/stock-push-interval';
import type { IStockPushPlanResult } from '../../stock-push/stock-push.service';
import type { IPushScheduleStatus } from '../../telegram/queue/services/stock-push.scheduler';

import { MARKETPLACES, MARKETPLACE_LABEL } from '../../../shared/marketplace';
import {
  STOCK_PUSH_MAX_ZEROED,
  STOCK_PUSH_ORDERS_WINDOW_DAYS,
  STOCK_PUSH_SKIP_TEXT,
  stockPushBlockTextOf,
} from '../../finance/stock-push';
import { STOCK_PUSH_EVENT_WINDOW_MS, webhookUrlOf } from '../../stock-push/marketplace-events';
import { PUSH_INTERVAL_LABEL, isPushInterval } from '../../stock-push/stock-push-interval';

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
export const INVALID_MARKETPLACES = 'INVALID_MARKETPLACES';
export const INVALID_MARKETPLACES_TEXT = 'Не выбрано, на какие площадки записать остатки.';

/** Правило одной строкой — на экране под шапкой, чтобы число «станет» читалось. */
export const STOCK_PUSH_RULE_TEXT =
  'Станет = количество из последнего прайса минус штуки заказов со своего склада ' +
  '(FBS/DBS/Экспресс) всех подключённых площадок, оформленных с дня загрузки прайса. ' +
  'Заказы дня загрузки вычитаются тоже: у заказа есть только день, а занизить остаток ' +
  'безопаснее, чем завысить. Отменённые не вычитаются, возвраты не прибавляются.';

export const STOCK_PUSH_NOTES: readonly string[] = [
  `Прайс старше ${STOCK_PUSH_ORDERS_WINDOW_DAYS} дней не годится: заказы площадок читаются за последние 30 дней.`,
  `Больше ${STOCK_PUSH_MAX_ZEROED} обнулений от продаж на площадку — запись на неё останавливается. ` +
    'Ноль из прайса (товара нет) пишется всегда, если прайс не обнулил всё разом.',
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
  /** Из `zeroed` — от вычета продаж; только они идут в порог обнулений. */
  zeroedBySales: number;
  unchanged: number;
  notListed: number;
  /** Товаров, которые площадка не примет (WB — несколько размеров). */
  notWritable: number;
  /** Товаров прайса нашлось на площадке; 0 — карточки не сопоставлены. */
  linked: number;
  /** Будет ли цель записана кнопкой: запись площадки открыта, нет блокировки, есть изменения. */
  willWrite: boolean;
}

export interface ICrmStockPush {
  takenAt: string;
  priceListDay: string | null;
  planHash: string;
  /** Открыта ли продавцу кнопка записи: хоть одна фича `stock_push_write_*`. */
  writeOpen: boolean;
  /** Сколько позиций уйдёт в запись по кнопке. */
  writeCount: number;
  ruleText: string;
  notes: string[];
  /** `blocksAll: false` — сбой закрывает только свою площадку (решение `stock_push_wb_orders_isolated`). */
  orderErrors: { marketplaceLabel: string; source: string; error: string; blocksAll: boolean }[];
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
      blockedText: stockPushBlockTextOf(target),
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
      zeroedBySales: target.zeroedBySales,
      unchanged: target.unchanged,
      notListed: target.notListed,
      notWritable: target.notWritable,
      linked: target.linked,
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
      blocksAll: item.blocksAll,
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

/**
 * Площадки, отмеченные на «Прайсе» (`ym|ozon|wb`, без повторов). `undefined` — поля
 * нет: пишутся все, как до выбора. `null` — пусто или чужое значение: молча писать
 * «всё» вместо выбранного нельзя.
 */
export function parseMarketplaces(value: unknown): TMarketplace[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length) return null;
  if (!value.every((item) => MARKETPLACES.includes(item as TMarketplace))) return null;
  return [...new Set(value as TMarketplace[])];
}

/** Отпечаток плана — sha256 hex: остальное до процессора не доходит. */
export function parsePlanHash(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : null;
}

export const INVALID_INTERVAL = 'INVALID_INTERVAL';
export const INVALID_INTERVAL_TEXT = 'Неизвестная частота синхронизации.';

/**
 * Зачем синхронизация — продавцу словами, один текст на «Прайс» и «Настройки»
 * (`stock_push_interval_by_seller`). Блок виден при двух и больше площадках:
 * с одной площадкой чужих продаж нет и вычитать нечего.
 */
export const STOCK_PUSH_SCHEDULE_ABOUT: readonly string[] = [
  'Товар лежит на вашем складе один, а продаётся сразу на нескольких площадках. Каждая площадка ' +
    'уменьшает остаток только при своём заказе и не знает о чужих: если товар раскупили на ' +
    'Wildberries, на Маркете и Ozon он ещё «в наличии». Придут заказы, которые нечем выполнить, ' +
    'а за отмены площадки штрафуют и снижают рейтинг.',
  'Поэтому мы регулярно пересчитываем остаток: количество из последнего прайса минус продажи со ' +
    'своего склада на всех площадках с дня загрузки прайса — и записываем это число на каждую ' +
    'площадку. Чем чаще синхронизация, тем меньше времени товар, которого уже нет, висит в продаже.',
  'Склады площадок (FBY, FBO, FBW) не трогаем. Если площадку не удалось прочитать, запись на неё ' +
    'в этот раз пропускается — следующая синхронизация попробует снова.',
];

export interface ICrmPushScheduleView {
  interval: TPushInterval;
  intervalLabel: string;
  /** Варианты в порядке показа. */
  options: { value: TPushInterval; label: string }[];
  about: readonly string[];
  nextRunAt: string | null;
  lastRun: { at: string; ok: boolean; summary: string } | null;
  /** Синхронизация по заказу — только при открытой `stock_push_events`. */
  events?: ICrmPushEventsView;
}

/** Адрес уведомлений площадки и куда его вставить. */
export interface ICrmPushEventTarget {
  marketplace: 'ym' | 'ozon';
  title: string;
  /** null — PUBLIC_BASE_URL не задан. */
  url: string | null;
  steps: readonly string[];
  lastEventAt: string | null;
}

export interface ICrmPushEventsView {
  about: string;
  /** Пусто — адресов нет: сервер не знает свой публичный адрес. */
  unavailable: string | null;
  targets: ICrmPushEventTarget[];
}

/** Порядок вариантов — от частого к редкому, «выключена» последней. */
const PUSH_INTERVAL_ORDER: readonly TPushInterval[] = ['30m', '1h', '3h', '6h', 'off'];

export function parseInterval(value: unknown): TPushInterval | null {
  return isPushInterval(value) ? value : null;
}

export function toCrmPushSchedule(status: IPushScheduleStatus): ICrmPushScheduleView {
  return {
    interval: status.interval,
    intervalLabel: PUSH_INTERVAL_LABEL[status.interval],
    options: PUSH_INTERVAL_ORDER.map((value) => ({ value, label: PUSH_INTERVAL_LABEL[value] })),
    about: STOCK_PUSH_SCHEDULE_ABOUT,
    nextRunAt: status.interval === 'off' ? null : status.nextRunAt,
    lastRun: status.lastRun
      ? {
          at: status.lastRun.at,
          ok: status.lastRun.status === 'ok',
          // Строка журнала начинается с вида прохода («передача остатков по расписанию: …») —
          // продавцу нужен итог после двоеточия.
          summary: status.lastRun.action.replace(/^[^:]*:\s*/, ''),
        }
      : null,
  };
}

const EVENT_WINDOW_MIN = STOCK_PUSH_EVENT_WINDOW_MS / 60_000;

export const STOCK_PUSH_EVENTS_ABOUT =
  'Маркет и Ozon умеют сами сообщать о новом заказе. Вставьте адрес ниже в кабинет площадки — ' +
  `и остатки на всех площадках обновятся в течение ${EVENT_WINDOW_MIN} минут после заказа, не дожидаясь ` +
  'синхронизации по расписанию. У Wildberries таких уведомлений нет: его заказы учитываются по расписанию. ' +
  'Адрес личный — не публикуйте его.';

export const STOCK_PUSH_EVENTS_UNAVAILABLE =
  'Адрес для уведомлений пока не настроен на сервере — напишите администратору.';

const EVENT_TARGETS: readonly {
  marketplace: 'ym' | 'ozon';
  title: string;
  steps: readonly string[];
}[] = [
  {
    marketplace: 'ym',
    title: 'Яндекс Маркет',
    steps: [
      'Кабинет продавца → значок аккаунта → «Настройки» → «API и модули» → вкладка «API-уведомления».',
      '«Подключить уведомления»: уровень — кабинет (все магазины) или магазин.',
      'Типы: «Заказ создан» и «Заказ отменён».',
      'URL — адрес ниже, «Подключить». Маркет проверит адрес сразу; уведомления пойдут в течение 2 минут.',
    ],
  },
  {
    marketplace: 'ozon',
    title: 'Ozon',
    // Запасной путь: обычно хватает кнопки «Подключить» (подписка через Seller API).
    steps: [
      'Кабинет продавца → «Настройки» → «Уведомления» → вкладка «Push уведомления».',
      '«Подключить», адрес — ниже, «Проверить»: Ozon пришлёт проверочный запрос.',
      '«Сохранить», затем в «Типах уведомлений» — «Новое отправление» и «Отмена отправления».',
    ],
  },
];

/** Блок «Синхронизация по заказу»: адрес на площадку, шаги, последнее событие. */
export function toCrmPushEvents(
  baseUrl: string | null,
  secret: string,
  lastEventAt: Partial<Record<'ym' | 'ozon', Date>>,
): ICrmPushEventsView {
  return {
    about: STOCK_PUSH_EVENTS_ABOUT,
    unavailable: baseUrl ? null : STOCK_PUSH_EVENTS_UNAVAILABLE,
    targets: EVENT_TARGETS.map((target) => ({
      ...target,
      url: webhookUrlOf(baseUrl, target.marketplace, secret),
      lastEventAt: lastEventAt[target.marketplace]
        ? new Date(lastEventAt[target.marketplace]).toISOString()
        : null,
    })),
  };
}

export const OZON_PUSH_UNAVAILABLE = 'OZON_PUSH_UNAVAILABLE';

/** Подписка Ozon для экрана: словами, без id и адресов чужих интеграций целиком. */
export interface ICrmOzonPushView {
  state: 'connected' | 'occupied' | 'none' | 'error';
  ok: boolean;
  text: string;
}

const AVAILABILITY_TEXT: Readonly<Record<string, string>> = {
  GREEN: 'Ozon видит адрес доступным',
  YELLOW: 'Ozon считает адрес нестабильным',
  RED: 'Ozon считает адрес недоступным',
};

export function toCrmOzonPush(status: TOzonPushState): ICrmOzonPushView {
  if (status.state === 'occupied') {
    return {
      state: 'occupied',
      ok: false,
      text:
        `Уведомления о заказах Ozon уже идут на другую интеграцию (${status.host}). ` +
        'Чтобы не сломать её, мы их не перехватываем — подключите адрес вручную, если она больше не нужна.',
    };
  }
  if (status.state === 'none') {
    return { state: 'none', ok: false, text: 'Уведомления Ozon о заказах не подключены.' };
  }
  const availability = AVAILABILITY_TEXT[status.availability] ?? 'Ozon ещё не проверил адрес';
  if (!status.enabled) {
    const reason = status.disableReason ? `: ${status.disableReason}` : '';
    return {
      state: 'connected',
      ok: false,
      text: `Подключено, но Ozon приостановил отправку${reason}.`,
    };
  }
  return {
    state: 'connected',
    ok: status.availability !== 'RED',
    text: `Подключено · ${availability}.`,
  };
}

/** Сбой Ozon при чтении или записи подписки — словами продавцу. */
export function ozonPushErrorView(error: unknown): ICrmOzonPushView {
  if (error instanceof Error && error.name === 'OzonNotConnectedError') {
    return {
      state: 'error',
      ok: false,
      text: 'Ozon не подключён — сначала добавьте ключ на «Подключениях».',
    };
  }
  const userMessage = (error as { userMessage?: unknown })?.userMessage;
  const text =
    typeof userMessage === 'string' && userMessage
      ? userMessage
      : 'Ozon не ответил — попробуйте позже.';
  return { state: 'error', ok: false, text };
}
