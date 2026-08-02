import type { IFbySupplyRequest } from '../yandex-api.client';
import type { IFbyStockSummary, TFbyStockType } from './fby-stock-report';

import { b, esc } from '../../telegram/formatting/telegram-format';
import { moscowStamp } from '../reports/moscow-day';
import { SUPPLY_STATUS } from '../reports/report-status-map';

/**
 * Текст сводки FBY одним экраном.
 *
 * Всё через esc(): названия товаров, складов и статусы приходят от Маркета и
 * содержат что угодно (`<`, `&`), а неэкранированная подстановка ломает разметку
 * ВСЕГО сообщения → Telegram 400 → сводка не доходит (как в report-message).
 *
 * Идентификаторы кампании/бизнеса не печатаются. Номер заявки и id склада — не
 * секрет, продавец видит их в кабинете.
 *
 * Каждый из четырёх блоков независим и МЯГКО ДЕГРАДИРУЕТ: если источник упал,
 * `null` на входе превращается в строку-заглушку, а не рушит экран.
 */

/** Порог: сколько проблемных позиций показывать списком, дальше — в файл. */
export const FBY_PROBLEM_INLINE_LIMIT = 30;

/** Сколько заявок показывать списком (дальше — «…и ещё N»). */
const REQUESTS_INLINE_LIMIT = 15;

/** Почему недоступны остатки — от этого зависит текст заглушки. */
export type TFbyStockError = 'rate_limit' | 'generic';

/**
 * Данные сводки. Каждое поле, которое может отсутствовать, — `null` (источник
 * недоступен), а не пустое значение: «нет данных» и «0» различаются в тексте.
 */
export interface IFbyOverviewData {
  /** Остатки и проблемные позиции из отчёта, либо null при сбое. */
  stock: IFbyStockSummary | null;
  /** Причина недоступности остатков — для точной заглушки. */
  stockError?: TFbyStockError;
  /** Заявки на вывоз/утилизацию, либо null при сбое. */
  requests: IFbySupplyRequest[] | null;
  /** «Едет до клиента» — количество, либо null при сбое. */
  inTransit: number | null;
  /** «Едет обратно» — количество, либо null при сбое. */
  returning: number | null;
}

const STOCK_LABEL: Readonly<Record<TFbyStockType, string>> = {
  AVAILABLE: '✅ Доступно к заказу',
  FIT: '🟢 Годный',
  FREEZE: '🔒 Резерв',
  QUARANTINE: '🟡 Карантин',
  DEFECT: '🔴 Брак',
  EXPIRED: '⏳ Просрочка',
  UTILIZATION: '♻️ К утилизации',
};

const STOCK_ORDER: readonly TFbyStockType[] = [
  'AVAILABLE',
  'FIT',
  'FREEZE',
  'QUARANTINE',
  'DEFECT',
  'EXPIRED',
  'UTILIZATION',
];

/** Тип заявки → короткое слово. */
const REQUEST_TYPE_LABEL: Readonly<Record<string, string>> = {
  WITHDRAW: 'вывоз',
  UTILIZATION: 'утилизация',
};

/**
 * Статус заявки → русская подпись. Набор статусов на боевом ШИРЕ enum openapi,
 * поэтому неизвестный код показываем как есть — лучше сырой код, чем потерять
 * смысл. Здесь только самые частые/важные для «что надо забрать».
 */
const REQUEST_STATUS_LABEL: Readonly<Record<string, string>> = {
  [SUPPLY_STATUS.READY_TO_WITHDRAW]: 'готово забрать',
  [SUPPLY_STATUS.READY_FOR_UTILIZATION]: 'готово к утилизации',
  CREATED: 'создана',
  PUBLISHED: 'опубликована',
  NEED_PREPARATION: 'нужна подготовка',
  TRANSIT_MOVING: 'в пути',
  WAREHOUSE_HANDLING: 'обрабатывается на складе',
  WAREHOUSE_SIGNED_ACT: 'акт подписан',
  ARRIVED_TO_SERVICE: 'прибыла на склад',
  // CANCELLED совпадает со статусом заказа — код берём из константы (см. её
  // комментарий в report-status-map), иначе «статусы не размазаны» ловит литерал.
  [SUPPLY_STATUS.CANCELLED]: 'отменена',
  [SUPPLY_STATUS.FINISHED]: 'завершена',
};

export function formatFbyOverview(data: IFbyOverviewData, now: Date = new Date()): string {
  const header = `📦 ${b('FBY')} ${esc(`на ${moscowStamp(now)} МСК`)}`;
  return [
    header,
    '',
    ...stockSection(data),
    '',
    ...requestsSection(data.requests),
    '',
    countsLine(data),
  ].join('\n');
}

function stockSection(data: IFbyOverviewData): string[] {
  const title = b('📊 Остатки на складе Маркета');

  if (!data.stock) {
    const line =
      data.stockError === 'rate_limit'
        ? '⚠️ Остатки обновляются, попробуйте через минуту.'
        : '⚠️ Остатки временно недоступны.';
    return [title, line];
  }

  const lines = [title];
  for (const type of STOCK_ORDER) {
    lines.push(`${STOCK_LABEL[type]}: ${b(formatCount(data.stock.totals[type]))}`);
  }

  lines.push('', ...problemLines(data.stock.problems));
  return lines;
}

function problemLines(problems: IFbyStockSummary['problems']): string[] {
  const title = '🔴 ' + b('Проблемные позиции') + ' (брак/просрочка/утиль)';

  if (!problems.length) return ['✅ Проблемных позиций нет.'];

  if (problems.length > FBY_PROBLEM_INLINE_LIMIT) {
    return [`${title}: ${b(problems.length)}`, 'Полный список — в файле ниже 👇'];
  }

  const rows = problems.map((p) => {
    const parts = [
      p.defect ? `брак ${p.defect}` : '',
      p.expired ? `просрочка ${p.expired}` : '',
      p.utilization ? `утиль ${p.utilization}` : '',
    ].filter(Boolean);
    const name = p.name ? ` ${esc(p.name)}` : '';
    return `• ${b(p.sku)}${name} — ${esc(parts.join(', '))}`;
  });

  return [`${title}: ${b(problems.length)}`, ...rows];
}

/**
 * Приоритет статуса для сортировки: сперва то, что надо ЗАБРАТЬ прямо сейчас,
 * в конце — терминальное (завершено/отменено). Смысл в том, что заявок бывают
 * десятки, а в сообщение влезает часть: actionable не должно тонуть в готовых.
 */
function statusRank(status: string): number {
  if (
    status === SUPPLY_STATUS.READY_TO_WITHDRAW ||
    status === SUPPLY_STATUS.READY_FOR_UTILIZATION
  ) {
    return 0;
  }
  if (status === SUPPLY_STATUS.CANCELLED || status === SUPPLY_STATUS.FINISHED) return 2;
  return 1;
}

function requestsSection(requests: IFbySupplyRequest[] | null): string[] {
  const title = b('🚚 Заявки на вывоз/утилизацию');

  if (!requests) return [title, '⚠️ Заявки временно недоступны.'];
  if (!requests.length) return [`${title}: ${b(0)}`, 'Активных заявок нет.'];

  const ordered = [...requests].sort((a, b2) => statusRank(a.status) - statusRank(b2.status));
  const shown = ordered.slice(0, REQUESTS_INLINE_LIMIT);
  const rows = shown.map((r) => {
    const type = REQUEST_TYPE_LABEL[r.type] ?? esc(r.type.toLowerCase());
    const status = REQUEST_STATUS_LABEL[r.status] ?? esc(r.status);
    const tail = [
      r.defectCount ? `брак ${r.defectCount}` : '',
      r.targetName ? `склад «${esc(r.targetName)}»` : '',
    ].filter(Boolean);
    return `• №${b(r.id)} — ${type} · ${status}${tail.length ? ', ' + tail.join(', ') : ''}`;
  });

  const lines = [`${title}: ${b(requests.length)}`, ...rows];
  if (requests.length > shown.length) lines.push(`…и ещё ${requests.length - shown.length}`);
  return lines;
}

function countsLine(data: IFbyOverviewData): string {
  const inTransit = data.inTransit == null ? '⚠️ недоступно' : b(formatCount(data.inTransit));
  const returning = data.returning == null ? '⚠️ недоступно' : b(formatCount(data.returning));
  return `📦 Едет до клиента: ${inTransit} · ↩️ Едет обратно: ${returning}`;
}

/** Целое с разбивкой тысяч пробелом: 12 345. */
function formatCount(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
