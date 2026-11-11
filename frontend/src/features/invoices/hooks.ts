import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { confirmInvoice, downloadInvoiceFile, listInvoices, updateInvoice, uploadInvoice, type Invoice, type InvoiceDirection, type InvoiceListQuery, type InvoiceUpdate } from "./api";

const MAX_PROCESSING_REFRESHES = 30;
const PROCESSING_REFRESH_INTERVAL_MS = 3_000;

export const invoiceListQueryKey = (companyId: string, query: InvoiceListQuery) =>
  ["company", companyId, "invoices", "list", query] as const;

function useInvalidateInvoices(companyId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["company", companyId, "invoices"] });
}

export function useInvoices(companyId: string, limit: number) {
  const query: InvoiceListQuery = { skip: 0, limit };
  return useQuery({
    queryKey: invoiceListQueryKey(companyId, query),
    queryFn: () => listInvoices(companyId, query),
    enabled: Boolean(companyId),
    retry: false,
    refetchInterval: (currentQuery) => {
      const hasProcessing = currentQuery.state.data?.some(
        (invoice) => invoice.processing_status === "pending" || invoice.processing_status === "processing",
      );
      const refreshCount = currentQuery.state.dataUpdateCount + currentQuery.state.errorUpdateCount;
      return hasProcessing && refreshCount < MAX_PROCESSING_REFRESHES
        ? PROCESSING_REFRESH_INTERVAL_MS
        : false;
    },
    refetchIntervalInBackground: false,
  });
}

export function useUploadInvoice(companyId: string) {
  const invalidate = useInvalidateInvoices(companyId);
  return useMutation({
    mutationFn: ({ file, direction }: { file: File; direction: InvoiceDirection }) => uploadInvoice(companyId, file, direction),
    retry: false,
    onSuccess: invalidate,
  });
}

export function useUpdateInvoice(companyId: string) {
  const invalidate = useInvalidateInvoices(companyId);
  return useMutation({
    mutationFn: ({ invoiceId, body }: { invoiceId: string; body: InvoiceUpdate }) => updateInvoice(companyId, invoiceId, body),
    retry: false,
    onSuccess: invalidate,
  });
}

export function useConfirmInvoice(companyId: string) {
  const invalidate = useInvalidateInvoices(companyId);
  return useMutation({
    mutationFn: (invoiceId: string) => confirmInvoice(companyId, invoiceId),
    retry: false,
    onSuccess: invalidate,
  });
}

export function useDownloadInvoice(companyId: string) {
  return useMutation({
    mutationFn: (invoiceId: string) => downloadInvoiceFile(companyId, invoiceId),
    retry: false,
  });
}

export type { Invoice };
