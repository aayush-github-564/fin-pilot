import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/utils";

export const Select = forwardRef<
  HTMLSelectElement,
  ComponentPropsWithoutRef<"select">
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 shadow-sm outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100",
      className,
    )}
    {...props}
  />
));
Select.displayName = "Select";
