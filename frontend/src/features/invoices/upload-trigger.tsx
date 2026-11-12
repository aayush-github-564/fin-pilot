import { FileUp } from "lucide-react";
import type { ComponentProps } from "react";

import { Button } from "../../components/ui/button";
import { useInvoiceUploadTrigger } from "./use-invoice-upload-trigger";

export function InvoiceUploadTrigger({
  label = "Upload invoice",
  variant = "primary",
  className,
}: {
  label?: string;
  variant?: "primary" | "secondary";
  className?: ComponentProps<typeof Button>["className"];
}) {
  const openUpload = useInvoiceUploadTrigger();

  return (
    <Button className={className} onClick={() => openUpload()} type="button" variant={variant}>
      <FileUp aria-hidden="true" className="size-4" />
      {label}
    </Button>
  );
}
