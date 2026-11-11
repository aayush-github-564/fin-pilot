import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

interface BrandLockupProps {
  className?: string;
  mark?: ReactNode;
  wordmarkClassName?: string;
}

export function BrandLockup({
  className,
  mark,
  wordmarkClassName,
}: BrandLockupProps) {
  return (
    <span className={cn("inline-flex items-center gap-[0.275em]", className)}>
      {mark && <span aria-hidden="true" className="shrink-0">{mark}</span>}
      <span className={cn("fp-wordmark", wordmarkClassName)}>FinPilot</span>
    </span>
  );
}
