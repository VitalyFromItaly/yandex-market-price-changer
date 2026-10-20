import type { OrderRow } from '../orders.domain';

/**
 * Ряд «по дням» для графика отчёта — из тех же строк, что таблица, поэтому
 * сумма столбцов равна итогу отчёта по построению (строки без даты не
 * рисуются и считаются отдельно — `undated`).
 *
 * Пропущенные дни заполняются нулями: ряд с дырами врёт о ритме продаж —
 * соседние столбцы выглядят соседними днями, хотя между ними неделя тишины.
 */
export interface DayPoint {
  /** ГГГГММДД строкой — тот же ключ, что `OrderRow.dateSort`. */
  key: string;
  /** «24-09» — подпись под столбцом. */
  label: string;
  /** «24-09-2026» — как в таблице и в боте. */
  date: string;
  count: number;
  sales: number;
}

export interface OrdersByDay {
  points: DayPoint[];
  undated: number;
  /** Сколько ранних дней не влезло в потолок. */
  clipped: number;
}

/**
 * Потолок ряда: «Всего» у архива может растянуться на годы, столбцы стали бы
 * нитками. Оставляются ПОСЛЕДНИЕ дни — свежее важнее; сумма такого ряда
 * меньше итога, и экран об этом говорит (`clipped`).
 */
export const MAX_DAYS = 93;

const pad = (n: number): string => String(n).padStart(2, '0');

function fromSort(sort: number): Date {
  const y = Math.floor(sort / 10_000);
  const m = Math.floor((sort % 10_000) / 100);
  const d = sort % 100;
  return new Date(Date.UTC(y, m - 1, d));
}

function toPoint(date: Date): DayPoint {
  const y = date.getUTCFullYear();
  const m = pad(date.getUTCMonth() + 1);
  const d = pad(date.getUTCDate());
  return { key: `${y}${m}${d}`, label: `${d}-${m}`, date: `${d}-${m}-${y}`, count: 0, sales: 0 };
}

export function ordersByDay(rows: readonly OrderRow[]): OrdersByDay {
  const byKey = new Map<number, { count: number; sales: number }>();
  let undated = 0;
  for (const row of rows) {
    if (!row.dateSort) {
      undated += 1;
      continue;
    }
    const bucket = byKey.get(row.dateSort) ?? { count: 0, sales: 0 };
    bucket.count += 1;
    bucket.sales += row.sales;
    byKey.set(row.dateSort, bucket);
  }
  if (byKey.size === 0) return { points: [], undated, clipped: 0 };

  const keys = [...byKey.keys()].sort((a, b) => a - b);
  const first = fromSort(keys[0] ?? 0);
  const last = fromSort(keys.at(-1) ?? 0);
  const points: DayPoint[] = [];
  for (let day = first; day <= last; day = new Date(day.getTime() + 86_400_000)) {
    const point = toPoint(day);
    const bucket = byKey.get(Number(point.key));
    points.push(bucket ? { ...point, ...bucket } : point);
  }
  const clipped = Math.max(points.length - MAX_DAYS, 0);
  return { points: points.slice(clipped), undated, clipped };
}

/** График нужен, когда есть что сравнивать: хотя бы два дня. Срез одного дня — число, а не ряд. */
export const worthCharting = (byDay: OrdersByDay): boolean => byDay.points.length >= 2;
