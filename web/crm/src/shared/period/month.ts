const MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
] as const;

/** «2026-09» → «Сентябрь 2026». */
export function monthLabel(month: string): string {
  const year = month.slice(0, 4);
  const name = MONTHS[Number(month.slice(5, 7)) - 1];
  return name === undefined ? month : `${name} ${year}`;
}

/**
 * Месяцы «ГГГГ-ММ» от текущего к старшему: текущий и `count − 1` прошлых.
 * `today` — «ГГГГ-ММ-ДД» по Москве. Набор совпадает с выбором «Финансов».
 */
export function recentMonths(today: string, count = 13): string[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const result: string[] = [];
  for (let shift = 0; shift < count; shift++) {
    const index = year * 12 + (month - 1) - shift;
    result.push(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`);
  }
  return result;
}
