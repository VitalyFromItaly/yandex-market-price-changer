import type { FbyProblem } from '../fby.domain';

/** Поиск по артикулу и названию, без учёта регистра. Порядок — серверный (худшие сверху). */
export function filterProblems(rows: readonly FbyProblem[], query: string): FbyProblem[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...rows];
  return rows.filter(
    (row) => row.sku.toLowerCase().includes(needle) || row.name.toLowerCase().includes(needle),
  );
}
