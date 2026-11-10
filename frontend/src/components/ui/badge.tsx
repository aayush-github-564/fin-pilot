import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils";

const badgeStyles = cva(
  "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold capitalize",
  {
    variants: {
      variant: {
        neutral: "bg-slate-100 text-slate-700",
        info: "bg-cyan-50 text-cyan-800",
        success: "bg-emerald-50 text-emerald-800",
        danger: "bg-rose-50 text-rose-800",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

type BadgeProps = ComponentProps<"span"> & VariantProps<typeof badgeStyles>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeStyles({ variant }), className)} {...props} />;
}
