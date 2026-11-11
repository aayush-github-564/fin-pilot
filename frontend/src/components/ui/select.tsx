import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/utils";

export const Select = forwardRef<
  HTMLSelectElement,
  ComponentPropsWithoutRef<"select">
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "min-h-12 w-full rounded-md border border-input-line bg-paper px-3.5 py-2.5 text-sm text-pine outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10",
      className,
    )}
    {...props}
  />
));
Select.displayName = "Select";
