import type { VariantProps } from 'class-variance-authority';

import { cva } from 'class-variance-authority';

export { default as Badge } from './Badge.vue';

/** Статусы — три смысла, один токен на смысл: ok (в норме), warn (ждёт человека), danger (сломалось). */
export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'bg-secondary text-secondary-foreground',
        /** Акцент, а не сбой: «нужно действие», выделенное продавцу. */
        brand: 'bg-brand-subtle text-brand',
        outline: 'border text-foreground',
        ok: 'bg-ok-subtle text-ok',
        warn: 'bg-warn-subtle text-warn',
        danger: 'bg-danger-subtle text-danger',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type BadgeVariants = VariantProps<typeof badgeVariants>;
