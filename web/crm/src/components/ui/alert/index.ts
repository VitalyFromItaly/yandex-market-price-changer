import type { VariantProps } from 'class-variance-authority';

import { cva } from 'class-variance-authority';

export { default as Alert } from './Alert.vue';

/** Сообщение формы или экрана. danger — не получилось; warn — не сбой, но нужен человек. */
export const alertVariants = cva(
  'flex items-start gap-2 rounded-md px-3 py-2 text-sm [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        danger: 'bg-danger-subtle text-danger',
        warn: 'bg-warn-subtle text-warn',
      },
    },
    defaultVariants: { variant: 'danger' },
  },
);

export type AlertVariants = VariantProps<typeof alertVariants>;
