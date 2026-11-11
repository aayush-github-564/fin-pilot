import type { ComponentProps } from "react";

import { cn } from "../../lib/utils";

export function ReadOnlyQueryBlock({
  children,
  className,
  ...props
}: ComponentProps<"pre">) {
  return (
    <pre className={cn("fp-query-block overflow-x-auto rounded-md border p-4", className)} {...props}>
      <code>{children}</code>
    </pre>
  );
}
