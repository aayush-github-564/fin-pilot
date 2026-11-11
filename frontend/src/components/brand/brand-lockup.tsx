import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

interface BrandLockupProps {
  className?: string;
  dark?: boolean;
  mark?: ReactNode;
  wordmarkClassName?: string;
}

export function BrandLockup({
  className,
  dark = false,
  mark,
  wordmarkClassName,
}: BrandLockupProps) {
  return (
    <span className={cn("inline-flex items-center gap-[0.275em]", className)}>
      <span aria-hidden="true" className="shrink-0">
        {mark ?? <img alt="" className="block h-[0.94em] w-auto" src={dark ? "/brand/mark-on-dark.svg" : "/brand/mark-on-light.svg"} />}
      </span>
      <span className={cn("fp-wordmark", wordmarkClassName)}>FinPilot</span>
    </span>
  );
}
