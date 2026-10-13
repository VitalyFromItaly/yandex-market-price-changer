/** Тона иконок и «блеск» блоков главной (решение crm_dashboard_vivid). Реэкспорт — из dashboard.domain.ts. */

// --- тона иконок -----------------------------------------------------------

/**
 * Цвет иконки — смысловой тон, а не цвет: таблица одна на карточки, строки
 * «Заказов» и площадки, все значения — токены темы (у chart-* своя тёмная пара).
 * `tile` — плашка под иконкой (единственный цвет KPI-карточки — TASK-098),
 * `text` — число в тон. Классы выписаны целиком: Tailwind собирает только
 * строки, которые видит в исходнике (решение crm_dashboard_vivid).
 */
export type IconTone = 'blue' | 'orange' | 'violet' | 'amber' | 'ok' | 'danger';

export const ICON_TONE_CLASS: Record<IconTone, { icon: string; tile: string; text: string }> = {
  blue: {
    icon: 'text-chart-1',
    tile: 'bg-gradient-to-br from-chart-1/25 to-chart-1/10 text-chart-1 ring-1 ring-inset ring-chart-1/25',
    text: 'text-chart-1',
  },
  orange: {
    icon: 'text-chart-2',
    tile: 'bg-gradient-to-br from-chart-2/25 to-chart-2/10 text-chart-2 ring-1 ring-inset ring-chart-2/25',
    text: 'text-chart-2',
  },
  violet: {
    icon: 'text-chart-6',
    tile: 'bg-gradient-to-br from-chart-6/25 to-chart-6/10 text-chart-6 ring-1 ring-inset ring-chart-6/25',
    text: 'text-chart-6',
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

/** Градиентная полоска по верху блока главной — общий «блеск» контейнеров. */
export const SHINY_CARD =
  'overflow-hidden before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-gradient-to-r before:opacity-60 before:from-chart-1 before:via-chart-6 before:to-chart-2';
