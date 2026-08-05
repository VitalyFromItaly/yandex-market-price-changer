import type { IFbySupplyRequest } from '../yandex-api.client';
import type { IFbyStockSummary, TFbyStockType } from './fby-stock-report';

import { b, esc } from '../../telegram/formatting/telegram-format';
import { moscowStamp } from '../reports/moscow-day';
import { SUPPLY_STATUS } from '../reports/report-status-map';
import { YandexApiError } from '../yandex-api.errors';

import { groupByCluster } from './fby-clusters';
import { FBY_STOCK_TYPES } from './fby-stock-report';

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

/**
 * Расшифровка нетривиальных типов — одной строкой под списком.
 *
 * «Резерв», «карантин» и «к утилизации» — термины склада Маркета, а не
 * общеупотребительные слова: продавец спросил «что означает карантин, они
 * проходят приёмку на возврат?». Отдельный экран-справка ради трёх слов не
 * нужен, а без пояснения цифра ничего не сообщает.
 *
 * Слова здесь ОБЯЗАНЫ совпадать с подписями STOCK_LABEL/STOCK_SHORT_LABEL: один
 * экран не должен звать одно и то же по-разному (тот же довод, что у коротких
 * подписей ниже). Литерал наш, пользовательских данных нет — esc не нужен, но и
 * `<`, `>`, `&` в тексте быть не должно: сообщение уходит с parse_mode HTML.
 */
const STOCK_HINT =
  'ℹ️ Резерв — отложено под оформленные заказы. Карантин — Маркет проверяет товар ' +
  '(возврат от покупателя, приёмка, вопросы к упаковке или маркировке), в продаже его нет: ' +
  'потом вернётся в годный или уйдёт в брак. К утилизации — Маркет спишет, если не заказать вывоз.';

/**
 * Порядок вывода типов. Берётся из парсера, а не пишется заново: там он уже
 * объявлен как «сперва живые, затем проблемные», и вторая копия разъехалась бы.
 */
const STOCK_ORDER: readonly TFbyStockType[] = FBY_STOCK_TYPES;

/**
 * Короткие подписи для строки кластера — ровно те слова, что уже печатает
 * problemLines (брак/просрочка/утиль): один экран не должен звать одно и то же
 * по-разному. Record по объединению — компилятор требует полноты.
 *
 * Экспортируется: экран «🏬 Склады» печатает те же остатки под каждым складом,
 * и третья копия слов гарантированно разъехалась бы — два экрана про один
 * склад обязаны звать одно и то же одинаково.
 */
export const STOCK_SHORT_LABEL: Readonly<Record<TFbyStockType, string>> = {
  AVAILABLE: 'доступно',
  FIT: 'годный',
  FREEZE: 'резерв',
  QUARANTINE: 'карантин',
  DEFECT: 'брак',
  EXPIRED: 'просрочка',
  UTILIZATION: 'утиль',
};

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

/**
 * Одна строка про то, почему остатков нет.
 *
 * Экспортируется и зовётся с экрана «🏬 Склады»: сбой у обоих экранов один и
 * тот же (один отчёт, один лимит), и говорить о нём двумя разными фразами
 * значит утверждать, что случилось разное.
 */
export function fbyStockUnavailableLine(error?: TFbyStockError): string {
  return error === 'rate_limit'
    ? '⚠️ Остатки обновляются, попробуйте через минуту.'
    : '⚠️ Остатки временно недоступны.';
}

function stockSection(data: IFbyOverviewData): string[] {
  const title = b('📊 Остатки на складе Маркета');

  if (!data.stock) return [title, fbyStockUnavailableLine(data.stockError)];

  const lines = [title];
  for (const type of STOCK_ORDER) {
    lines.push(`${STOCK_LABEL[type]}: ${b(formatCount(data.stock.totals[type]))}`);
  }

  // Подсказка стоит сразу под списком типов, который она и объясняет: строки
  // кластеров ниже пользуются теми же словами, и объяснять их задним числом
  // поздно. В ветке «остатков нет» её не будет по построению — расшифровывать
  // типы, которых на экране нет, незачем.
  lines.push('', STOCK_HINT);

  lines.push(...clusterLines(data.stock.byWarehouse));
  lines.push('', ...problemLines(data.stock.problems));
  lines.push(...exportLine());
  return lines;
}

/**
 * Разбивка остатков по кластерам-территориям — компактной строкой на кластер,
 * только ненулевые типы (экран и так длинный: заявки, проблемные позиции).
 *
 * Какие склады чьи — решает реестр fby-clusters; склад вне реестра печатается
 * СВОИМ именем (данные Маркета → через esc внутри b), а не прячется в «прочие»:
 * новая площадка Яндекса должна быть видна без правки кода. Заголовки кластеров
 * из реестра — наши литералы, как STOCK_LABEL.
 */
function clusterLines(byWarehouse: IFbyStockSummary['byWarehouse']): string[] {
  const groups = groupByCluster(byWarehouse);
  if (!groups.length) return [];

  const lines = groups.map((group) => {
    const totals = sumTotals(group.warehouses.map((w) => w.value));
    const parts = STOCK_ORDER.filter((type) => totals[type] > 0).map(
      (type) => `${STOCK_SHORT_LABEL[type]} ${b(formatCount(totals[type]))}`,
    );
    // Пустое имя склада бывает у строк CSV без колонки WAREHOUSE — парсер их
    // не выбрасывает, чтобы сумма кластеров сходилась с общими итогами.
    const title = group.key === null ? esc(group.title || 'склад без названия') : group.title;
    return `📍 ${title}: ${parts.length ? parts.join(' · ') : 'пусто'}`;
  });

  return ['', ...lines];
}

/** Сумма по-складовых итогов группы — по типам. */
function sumTotals(
  values: readonly Record<TFbyStockType, number>[],
): Record<TFbyStockType, number> {
  const sum = {} as Record<TFbyStockType, number>;
  for (const type of STOCK_ORDER) {
    sum[type] = values.reduce((acc, totals) => acc + totals[type], 0);
  }
  return sum;
}

/**
 * Строка про файл. Он приходит ВСЕГДА, когда остатки добылись, — сообщение
 * остаётся сводкой, а таблица SKU×склад живёт только в xlsx: тысячи строк не
 * помещаются в 4096 символов ни при каком пороге.
 */
function exportLine(): string[] {
  return ['', '📎 Полные данные — в файле ниже: остатки по складам, позиции и проблемные 👇'];
}

function problemLines(problems: IFbyStockSummary['problems']): string[] {
  const title = '🔴 ' + b('Проблемные позиции') + ' (брак/просрочка/утиль)';

  if (!problems.length) return ['✅ Проблемных позиций нет.'];

  // Длинный список не перечисляем — на файл указывает общая строка ниже, и две
  // отсылки к одному и тому же файлу читались бы как два разных файла.
  if (problems.length > FBY_PROBLEM_INLINE_LIMIT) return [`${title}: ${b(problems.length)}`];

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

/** Целое с разбивкой тысяч пробелом: 12 345. Экран складов печатает так же. */
export function formatCount(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Текст об ошибке сборки сводки — для пользователя.
 *
 * Один на оба пути: постановку джобы (fby.handler) и саму сборку
 * (fby-overview.processor) — паттерн uploadErrorText из stock-report.ts.
 */
export function fbyOverviewErrorText(error: unknown): string {
  const text =
    error instanceof YandexApiError
      ? error.userMessage
      : 'Не удалось собрать сводку FBY. Попробуйте позже.';
  return `❌ ${text}`;
}
