import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils";

const badgeStyles = cva(
  "inline-flex items-center rounded-sm px-2.5 py-1 text-xs font-bold uppercase",
  {
    variants: {
      variant: {
        neutral: "bg-linen text-foreground-body",
        info: "bg-signal-deep/10 text-accent",
        success: "bg-positive/10 text-positive",
        danger: "bg-negative/10 text-negative",
        caution: "bg-caution text-pine",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

type BadgeProps = ComponentProps<"span"> & VariantProps<typeof badgeStyles>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeStyles({ variant }), className)} {...props} />;
}
