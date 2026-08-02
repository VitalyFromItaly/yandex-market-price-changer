import type { IWarehouseInfo, IWarehousesOverview } from '../yandex-api.client';

import { b, esc } from '../../telegram/formatting/telegram-format';
import { moscowStamp } from '../reports/moscow-day';

/**
 * Текст обзора складов для Telegram.
 *
 * Всё через esc(): названия и адреса складов приходят от Маркета и содержат что
 * угодно, включая `<` и `&`. Неэкранированная подстановка ломает разметку ВСЕГО
 * сообщения, и Telegram отвечает 400 — обзор не доходит вовсе (та же причина,
 * что в report-message.ts).
 *
 * Идентификаторы кампании и бизнеса здесь НЕ печатаются — правило «продавцу их
 * не показываем» действует и тут. Печатается только id склада: это не секрет,
 * его продавец видит и в кабинете, и он единственное, чем один склад отличается
 * от другого одноимённого.
 *
 * Это СНИМОК, а не срез за период, поэтому в шапке — момент съёмки: обзор без
 * времени нечем сверить с кабинетом (тот же приём, что у «Едет до клиента»).
 */

const FBY_TITLE = '📦 FBY — склад Маркета';
const FBY_HINT = 'Товар хранит и отгружает Маркет.';
const STORE_TITLE = '🏪 Склад магазина';
const STORE_HINT = 'Ваши склады отгрузки (FBS/DBS/Экспресс).';

/** Одна строка склада: «• Название (адрес) — id 123 · Экспресс · группа». */
function warehouseLine(warehouse: IWarehouseInfo): string {
  const tail: string[] = [`id ${esc(warehouse.id)}`];
  if (warehouse.express) tail.push('Экспресс');
  if (warehouse.groupName) tail.push(`группа «${esc(warehouse.groupName)}»`);

  const address = warehouse.address ? ` (${esc(warehouse.address)})` : '';
  return `• ${b(warehouse.name)}${address} — ${tail.join(' · ')}`;
}

/** Секция одного типа складов: заголовок, пояснение и список либо «нет». */
function section(title: string, hint: string, warehouses: IWarehouseInfo[]): string[] {
  const lines = [b(title), esc(hint)];
  if (!warehouses.length) {
    lines.push('— нет');
    return lines;
  }
  for (const warehouse of warehouses) lines.push(warehouseLine(warehouse));
  return lines;
}

export function formatWarehousesOverview(
  overview: IWarehousesOverview,
  now: Date = new Date(),
): string {
  const total = overview.fulfillment.length + overview.store.length;

  const header = `🏬 ${b('Склады')} ${esc(`на ${moscowStamp(now)} МСК`)}`;

  if (total === 0) {
    return [header, '', 'У этого магазина не найдено ни одного склада.'].join('\n');
  }

  return [
    header,
    '',
    ...section(FBY_TITLE, FBY_HINT, overview.fulfillment),
    '',
    ...section(STORE_TITLE, STORE_HINT, overview.store),
  ].join('\n');
}
