/** Тон числа: обычный, «в плюсе», «в минусе». Цвет редок — только у итогов. */
export type KpiCardTone = 'neutral' | 'ok' | 'danger';

export const KPI_VALUE_CLASS: Record<KpiCardTone, string> = {
  neutral: '',
  ok: 'text-ok',
  danger: 'text-danger',
};

/** Подсветка итоговой карточки — фон и рамка тоном её числа. */
export const KPI_ACCENT_CLASS: Record<KpiCardTone, string> = {
  neutral: 'bg-muted/40',
  ok: 'border-ok/40 bg-ok-subtle',
  danger: 'border-danger/40 bg-danger-subtle',
};
