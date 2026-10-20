/**
 * Динамика к прошлому периоду одной фразой — общая для «Обзора» и «Аналитики
 * продаж» (TASK-140): два экрана, описывающие одно сравнение разными словами,
 * читались бы как две разные метрики.
 */

const PERCENT = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

/** Изменение в процентах со знаком: «+12,3 %»; прошлого нет или он нулевой — null. */
export function deltaPercent(current: number, previous: number): string | null {
  if (previous === 0) return null;
  const change = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(change) < 0.05) return '0 %';
  const sign = change > 0 ? '+' : '−';
  return `${sign}${PERCENT.format(Math.abs(change))} %`;
}

/** «+12,3 % к прошлому периоду»; прошлого нет или он нулевой — null. */
export function deltaCaption(current: number, previous: number): string | null {
  if (previous === 0) return current === 0 ? null : 'в прошлом периоде — ноль';
  const percent = deltaPercent(current, previous);
  return percent === '0 %' ? 'как в прошлом периоде' : `${percent} к прошлому периоду`;
}
