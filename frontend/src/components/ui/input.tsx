import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/utils";

export const Input = forwardRef<
  HTMLInputElement,
  ComponentPropsWithoutRef<"input">
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "min-h-12 w-full rounded-md border border-input-line bg-paper px-3.5 py-2.5 text-sm text-pine outline-none transition placeholder:text-stone focus:border-accent focus:ring-4 focus:ring-accent/10 disabled:cursor-not-allowed disabled:bg-linen",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
