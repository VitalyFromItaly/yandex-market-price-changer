/** «2026-07-31» → «31-07-2026» — даты отчётов Маркета в формате бота. */
export function isoDayToRu(iso: string): string {
  const [year, month, day] = iso.split('-');
  return day && month && year ? `${day}-${month}-${year}` : iso;
}
