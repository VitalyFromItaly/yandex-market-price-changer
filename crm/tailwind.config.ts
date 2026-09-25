import type { Config } from 'tailwindcss';

/**
 * Цвета — только семантические имена поверх CSS-переменных из
 * src/assets/index.css. Литерал цвета в коде фичи — это второй источник
 * палитры, и тёмная тема его не увидит.
 */
const token = (name: string): string => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  content: [`${__dirname}/index.html`, `${__dirname}/src/**/*.{vue,ts}`],
  // Тему ставит useTheme атрибутом на <html>; `dark:` нужен редко — цвета и так из токенов.
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        background: token('background'),
        foreground: token('foreground'),
        card: { DEFAULT: token('card'), foreground: token('card-foreground') },
        popover: { DEFAULT: token('popover'), foreground: token('popover-foreground') },
        muted: { DEFAULT: token('muted'), foreground: token('muted-foreground') },
        border: token('border'),
        input: token('input'),
        ring: token('ring'),
        primary: {
          DEFAULT: token('primary'),
          foreground: token('primary-foreground'),
          subtle: token('primary-subtle'),
        },
        brand: {
          DEFAULT: token('brand'),
          foreground: token('brand-foreground'),
          subtle: token('brand-subtle'),
        },
        link: token('link'),
        secondary: { DEFAULT: token('secondary'), foreground: token('secondary-foreground') },
        accent: { DEFAULT: token('accent'), foreground: token('accent-foreground') },
        destructive: {
          DEFAULT: token('destructive'),
          foreground: token('destructive-foreground'),
        },
        ok: { DEFAULT: token('ok'), subtle: token('ok-subtle') },
        warn: { DEFAULT: token('warn'), subtle: token('warn-subtle') },
        danger: { DEFAULT: token('danger'), subtle: token('danger-subtle') },
        chart: {
          1: token('chart-1'),
          2: token('chart-2'),
          3: token('chart-3'),
          4: token('chart-4'),
          5: token('chart-5'),
          6: token('chart-6'),
          series: token('chart-series'),
          grid: token('chart-grid'),
          axis: token('chart-axis'),
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: [
          '"Inter Variable"',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
} satisfies Config;
