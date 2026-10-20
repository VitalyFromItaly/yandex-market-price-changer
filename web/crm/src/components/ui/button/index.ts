import type { VariantProps } from 'class-variance-authority';

import { cva } from 'class-variance-authority';

export { default as Button } from './Button.vue';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ' +
    'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
    'focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none ' +
    'disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary font-semibold text-primary-foreground shadow-sm hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        /** Выбранный вариант в группе (период, фильтр): синяя рамка и подкраска — чип макета, не основное действие. */
        soft: 'border border-primary bg-primary-subtle text-foreground shadow-[0_0_0_1px] shadow-primary/40 hover:bg-primary-subtle/80',
        /** Невыбранный вариант в группе — чип с рамкой, как фильтры макета. */
        chip: 'border border-border bg-muted/60 text-muted-foreground hover:bg-accent hover:text-foreground',
        link: 'text-link underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-6',
        icon: 'size-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export type ButtonVariants = VariantProps<typeof buttonVariants>;
