/** Тона иконок главной (решения crm_dashboard_vivid → crm_redesign_markethub_dark). Реэкспорт — из dashboard.domain.ts. */

// --- тона иконок -----------------------------------------------------------

/**
 * Цвет иконки — смысловой тон, а не цвет: таблица одна на карточки, строки
 * «Заказов» и площадки, все значения — токены темы (у chart-* своя тёмная пара).
 * `tile` — плашка под иконкой (единственный цвет KPI-карточки — TASK-098),
 * `text` — число в тон. Классы выписаны целиком: Tailwind собирает только
 * строки, которые видит в исходнике (решение crm_dashboard_vivid).
 */
export type IconTone = 'blue' | 'rose' | 'violet' | 'amber' | 'ok' | 'danger';

export const ICON_TONE_CLASS: Record<IconTone, { icon: string; tile: string; text: string }> = {
  blue: {
    icon: 'text-chart-1',
    tile: 'bg-gradient-to-br from-chart-1/25 to-chart-1/10 text-chart-1 ring-1 ring-inset ring-chart-1/25',
    text: 'text-chart-1',
  },
  rose: {
    icon: 'text-chart-5',
    tile: 'bg-gradient-to-br from-chart-5/25 to-chart-5/10 text-chart-5 ring-1 ring-inset ring-chart-5/25',
    text: 'text-chart-5',
  },
  violet: {
    icon: 'text-chart-3',
    tile: 'bg-gradient-to-br from-chart-3/25 to-chart-3/10 text-chart-3 ring-1 ring-inset ring-chart-3/25',
    text: 'text-chart-3',
  },
  amber: {
    icon: 'text-chart-4',
    tile: 'bg-gradient-to-br from-chart-4/25 to-chart-4/10 text-chart-4 ring-1 ring-inset ring-chart-4/25',
    text: 'text-chart-4',
  },
  ok: {
    icon: 'text-ok',
    tile: 'bg-gradient-to-br from-ok/25 to-ok/10 text-ok ring-1 ring-inset ring-ok/25',
    text: 'text-ok',
  },
  danger: {
    icon: 'text-danger',
    tile: 'bg-gradient-to-br from-danger/25 to-danger/10 text-danger ring-1 ring-inset ring-danger/25',
    text: 'text-danger',
  },
};
