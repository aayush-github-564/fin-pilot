import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/utils";

const buttonStyles = cva(
  "inline-flex items-center justify-center gap-2 rounded-md bg-transparent text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/20 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "min-h-11 rounded-md bg-pine font-bold text-paper hover:bg-fir focus-visible:ring-dark-accent/40",
        secondary: "min-h-10 rounded-sm border border-pine bg-transparent font-semibold text-pine hover:bg-linen",
        quiet: "min-h-11 text-stone hover:bg-linen hover:text-pine",
        danger: "min-h-11 rounded-md bg-negative font-bold text-paper hover:bg-negative/90",
      },
      size: {
        default: "min-h-11 px-4 py-2.5",
        sm: "min-h-10 px-3 py-2 text-xs",
        lg: "min-h-12 px-5 py-3",
        icon: "size-11",
      },
    },
    compoundVariants: [
      { variant: "secondary", size: "default", class: "min-h-10 rounded-sm" },
    ],
    defaultVariants: { variant: "primary", size: "default" },
  },
);

interface ButtonProps
  extends ComponentPropsWithoutRef<"button">,
    VariantProps<typeof buttonStyles> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ asChild = false, className, size, variant, ...props }, ref) => {
    const Component = asChild ? Slot : "button";
    return (
      <Component
        ref={ref}
        className={cn(buttonStyles({ size, variant }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
