/** Тон числа: обычный, «в плюсе», «в минусе». Цвет редок — только у итогов. */
export type KpiCardTone = 'neutral' | 'ok' | 'danger';

export const KPI_VALUE_CLASS: Record<KpiCardTone, string> = {
  neutral: '',
  ok: 'text-ok',
  danger: 'text-danger',
};

/**
 * Подсветка итоговой карточки — градиент и рамка тоном её числа (карточка
 * «Чистая прибыль» макета MarketHub: зелёная в плюсе, малиновая в минусе).
 */
export const KPI_ACCENT_CLASS: Record<KpiCardTone, string> = {
  neutral: 'from-muted to-card-2',
  ok: 'border-ok/40 from-ok-subtle to-card',
  danger: 'border-danger/40 from-danger-subtle to-card',
};
