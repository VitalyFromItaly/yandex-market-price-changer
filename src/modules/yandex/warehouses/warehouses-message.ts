import type { TFbyStockError } from '../fby/fby-message';
import type { IFbyStockSummary, TFbyStockType } from '../fby/fby-stock-report';
import type { IWarehouseInfo, IWarehousesOverview } from '../yandex-api.client';
import type { IWarehouseStockRow } from './warehouse-stock';

import { b, esc } from '../../telegram/formatting/telegram-format';
import { fbyStockUnavailableLine, formatCount, STOCK_SHORT_LABEL } from '../fby/fby-message';
import { FBY_STOCK_TYPES } from '../fby/fby-stock-report';
import { moscowStamp } from '../reports/moscow-day';
import { YandexApiError } from '../yandex-api.errors';

import { joinWarehouseStock } from './warehouse-stock';

/**
 * Текст обзора складов для Telegram.
 *
 * Всё через esc(): названия и адреса складов приходят от Маркета и содержат что
 * угодно, включая `<` и `&`. Неэкранированная подстановка ломает разметку ВСЕГО
 * сообщения, и Telegram отвечает 400 — обзор не доходит вовсе (та же причина,
 * что в report-message.ts). Отдельно про имя склада, известного только отчёту:
 * оно приходит прямо из ячейки CSV и экранирования требует ровно так же.
 *
 * Идентификаторы кампании и бизнеса здесь НЕ печатаются — правило «продавцу их
 * не показываем» действует и тут. Печатается только id склада: это не секрет,
 * его продавец видит и в кабинете, и он единственное, чем один склад отличается
 * от другого одноимённого.
 *
 * Это СНИМОК, а не срез за период, поэтому в шапке — момент съёмки: обзор без
 * времени нечем сверить с кабинетом (тот же приём, что у «Едет до клиента»).
 * Отметок времени ДВЕ: шапка — когда собран экран, строка под заголовком FBY —
 * на какой момент сняты остатки. Они расходятся, когда отчёт взят из свежего
 * разбора (см. FbyStockService), и умолчать о расхождении значит выдать данные
 * трёхминутной давности за текущие.
 */

const FBY_TITLE = '📦 FBY — склад Маркета';
const FBY_HINT = 'Товар хранит и отгружает Маркет.';
const STORE_TITLE = '🏪 Склад магазина';
const STORE_HINT = 'Ваши склады отгрузки (FBS/DBS/Экспресс).';

/** Склад из отчёта, которого нет в списке Маркета, — так и говорим. */
const NOT_IN_LIST = '⚠️ нет в списке складов Маркета';

/** Данные экрана: список складов плюс остатки FBY, если они добылись. */
export interface IWarehousesScreenData {
  overview: IWarehousesOverview;
  /**
   * Остатки по складам из отчёта, либо `null` — отчёт недоступен. Именно
   * `null`, а не пустой объект: «нет данных» и «везде ноль» — разные ответы.
   */
  byWarehouse: IFbyStockSummary['byWarehouse'] | null;
  /** Момент, НА который сняты остатки. */
  stockTakenAt?: Date;
  /** Почему остатков нет — от этого зависит текст заглушки. */
  stockError?: TFbyStockError;
}

/** Одна строка склада магазина: «• Название (адрес) — id 123 · Экспресс · группа». */
function storeLine(warehouse: IWarehouseInfo): string {
  const tail: string[] = [`id ${esc(warehouse.id)}`];
  if (warehouse.express) tail.push('Экспресс');
  if (warehouse.groupName) tail.push(`группа «${esc(warehouse.groupName)}»`);

  const address = warehouse.address ? ` (${esc(warehouse.address)})` : '';
  return `• ${b(warehouse.name)}${address} — ${tail.join(' · ')}`;
}

/** Ненулевые типы остатков компактно: «доступно 1 234 · резерв 12». */
function stockParts(totals: Readonly<Record<TFbyStockType, number>>): string[] {
  return FBY_STOCK_TYPES.filter((type) => totals[type] > 0).map(
    (type) => `${STOCK_SHORT_LABEL[type]} ${b(formatCount(totals[type]))}`,
  );
}

/** Одна строка склада Маркета: идентификаторы и остатки в одном хвосте. */
function fbyLine(row: IWarehouseStockRow): string {
  const tail: string[] = [];

  tail.push(row.ids.length ? `id ${esc(row.ids.join(', '))}` : NOT_IN_LIST);

  // totals === null — отчёта нет вовсе, и об этом уже сказано строкой выше:
  // повторять «нет данных» у каждого склада незачем. Нули — это «пусто».
  if (row.totals) tail.push(...(row.count > 0 ? stockParts(row.totals) : ['пусто']));

  const address = row.address ? ` (${esc(row.address)})` : '';
  return `• ${b(row.name)}${address} — ${tail.join(' · ')}`;
}

/**
 * Итог считается по СТРОКАМ экрана, а не берётся из общих итогов отчёта: тогда
 * то, что показано, складывается в то, что подписано снизу. Взять `totals`
 * напрямую значило бы спрятать ошибку соединения по имени.
 */
function totalLine(rows: readonly IWarehouseStockRow[]): string {
  const sum = {} as Record<TFbyStockType, number>;
  for (const type of FBY_STOCK_TYPES) {
    sum[type] = rows.reduce((acc, row) => acc + (row.totals?.[type] ?? 0), 0);
  }

  const parts = stockParts(sum);
  return `Итого: ${parts.length ? parts.join(' · ') : 'пусто'}`;
}

function fbySection(data: IWarehousesScreenData, rows: readonly IWarehouseStockRow[]): string[] {
  const lines = [b(FBY_TITLE), esc(FBY_HINT)];

  if (!data.byWarehouse) {
    lines.push(fbyStockUnavailableLine(data.stockError));
  } else if (data.stockTakenAt) {
    lines.push(esc(`Остатки — из отчёта Маркета на ${moscowStamp(data.stockTakenAt)} МСК.`));
  }

  if (!rows.length) {
    lines.push('— нет');
    return lines;
  }

  for (const row of rows) lines.push(fbyLine(row));
  if (data.byWarehouse) lines.push(totalLine(rows));
  return lines;
}

function storeSection(warehouses: readonly IWarehouseInfo[]): string[] {
  const lines = [b(STORE_TITLE), esc(STORE_HINT)];
  if (!warehouses.length) {
    lines.push('— нет');
    return lines;
  }
  for (const warehouse of warehouses) lines.push(storeLine(warehouse));
  return lines;
}

export function formatWarehousesOverview(
  data: IWarehousesScreenData,
  now: Date = new Date(),
): string {
  const rows = joinWarehouseStock(data.overview.fulfillment, data.byWarehouse);
  const header = `🏬 ${b('Склады')} ${esc(`на ${moscowStamp(now)} МСК`)}`;

  if (rows.length + data.overview.store.length === 0) {
    return [header, '', 'У этого магазина не найдено ни одного склада.'].join('\n');
  }

  return [header, '', ...fbySection(data, rows), '', ...storeSection(data.overview.store)].join(
    '\n',
  );
}

/**
 * Текст об ошибке сборки обзора — для пользователя.
 *
 * Один на оба пути: постановку джобы (warehouses.handler) и саму сборку
 * (warehouses-overview.processor) — приём uploadErrorText и fbyOverviewErrorText.
 */
export function warehousesErrorText(error: unknown): string {
  const text =
    error instanceof YandexApiError
      ? error.userMessage
      : 'Не удалось получить список складов. Попробуйте позже.';
  return `❌ ${text}`;
}
