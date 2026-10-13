import { moscowDay } from './moscow-day';

/**
 * Московский календарный день заказа — `ГГГГ-ММ-ДД` — из любой формы даты,
 * которую присылает Маркет. Нужен ряду «по дням» прибыли (`profitOf`).
 *
 * Формы разные, и путать их нельзя:
 * - `ДД-ММ-ГГГГ ЧЧ:ММ:СС` — `creationDate`/`updatedAt` живого getOrders, УЖЕ
 *   по Москве (OrderDTO). Части переставляются строкой: `new Date` такую форму
 *   не разбирает, а разобранная как UTC сдвинула бы вечерние заказы на сутки;
 * - `ГГГГ-ММ-ДД` — `creationDate` архива stats/orders;
 * - ISO без смещения (`statusUpdateDate` архива) — по спеке московское время,
 *   день — префикс строки;
 * - ISO со смещением или `Z` — момент; день берёт moscowDay, а не арифметика
 *   миллисекунд (довод moscow-day.ts: контейнер живёт в UTC).
 *
 * Мусор — null: заказ без даты на ряд не ложится, и вызывающий его считает.
 */
export function orderDayIso(value: string | undefined | null): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;

  const ru = /^(\d{2})-(\d{2})-(\d{4})(?:\s|$)/.exec(text);
  if (ru) return valid(`${ru[3]}-${ru[2]}-${ru[1]}`);

  const iso = /^(\d{4}-\d{2}-\d{2})(.*)$/.exec(text);
  if (!iso) return null;

  const rest = iso[2];
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(rest)) return valid(iso[1]);

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  const { year, month, day } = moscowDay(parsed);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Календарная проверка: «31-02» и «00-13» датами не являются. */
function valid(iso: string): string | null {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    ? iso
    : null;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
